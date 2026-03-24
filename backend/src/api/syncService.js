'use strict';

const { getDb }    = require('../db/database');
const sportmonks   = require('./sportmonks');
const { calculateFantasyPoints, DEFAULT_SCORING_CONFIG } = require('../engines/scoringEngine');
const { processAutoSwaps } = require('../engines/swapEngine');

// ── Upsert squad from Sportmonks lineup ──────────────────────────────────────
function upsertSquad(matchId, players) {
  const db = getDb();

  const upsertPlayer = db.prepare(`
    INSERT INTO players (name, team, role, external_player_id, sportmonks_player_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(external_player_id) DO UPDATE SET
      name = excluded.name,
      team = excluded.team,
      role = excluded.role,
      sportmonks_player_id = excluded.sportmonks_player_id
  `);

  const upsertSquadEntry = db.prepare(`
    INSERT INTO match_squads (match_id, player_id, is_playing_xi)
    VALUES (?, ?, ?)
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      is_playing_xi = excluded.is_playing_xi
  `);

  const getPlayerByExternal = db.prepare(
    'SELECT id FROM players WHERE external_player_id = ?'
  );

  const doUpsert = db.transaction((players) => {
    for (const p of players) {
      const extId = String(p.externalPlayerId || p.sportmonks_player_id);
      upsertPlayer.run(p.name, p.team, p.role || 'batsman', extId, p.sportmonksPlayerId || null);
      const player = getPlayerByExternal.get(extId);
      if (!player) continue;
      upsertSquadEntry.run(matchId, player.id, p.isPlayingXi ? 1 : 0);
    }
  });

  doUpsert(players);
}

// ── Sync playing XI from Sportmonks lineup ───────────────────────────────────
async function syncPlayingXi(matchId, sportmonksFixtureId) {
  const db = getDb();
  const lineup = await sportmonks.fetchFixtureLineup(sportmonksFixtureId);
  if (!lineup || lineup.length === 0) return { confirmed: false, count: 0 };

  const getPlayer = db.prepare(
    'SELECT id FROM players WHERE external_player_id = ?'
  );
  const updateXi = db.prepare(
    'UPDATE match_squads SET is_playing_xi = ? WHERE match_id = ? AND player_id = ?'
  );
  const resetXi = db.prepare(
    'UPDATE match_squads SET is_playing_xi = 0 WHERE match_id = ?'
  );

  const doSync = db.transaction(() => {
    resetXi.run(matchId);
    for (const p of lineup) {
      const player = getPlayer.get(String(p.externalPlayerId));
      if (player) updateXi.run(1, matchId, player.id);
    }
  });
  doSync();

  // Award +4 Playing XI bonus immediately to all confirmed XI players
  // by upserting minimal stat records with isPlayingXi=true
  const xiPlayers = db.prepare(
    'SELECT player_id FROM match_squads WHERE match_id = ? AND is_playing_xi = 1'
  ).all(matchId);

  const upsertXiStat = db.prepare(`
    INSERT INTO player_match_stats
      (match_id, player_id, runs, balls_faced, fours, sixes, dismissal_type,
       overs_bowled, wickets, runs_conceded, maidens,
       catches, stumpings, run_outs, fantasy_points, updated_at)
    VALUES (?, ?, 0, 0, 0, 0, 'dnb', 0, 0, 0, 0, 0, 0, 0, 4, datetime('now'))
    ON CONFLICT(match_id, player_id) DO NOTHING
  `);

  const { calculateFantasyPoints, DEFAULT_SCORING_CONFIG } = require('../engines/scoringEngine');
  const insertXi = db.transaction(() => {
    for (const { player_id } of xiPlayers) {
      upsertXiStat.run(matchId, player_id);
    }
  });
  insertXi();

  await processAutoSwaps(matchId);
  recomputeTeamPoints(matchId);
  return { confirmed: true, count: lineup.length };
}

// ── Upsert player stats from Sportmonks scorecard ───────────────────────────
function upsertStats(matchId, playerStats) {
  const db = getDb();

  const getPlayerByExternal = db.prepare(
    'SELECT id FROM players WHERE external_player_id = ?'
  );
  const getPlayerByName = db.prepare(
    'SELECT id FROM players WHERE LOWER(name) = LOWER(?)'
  );
  const upsertPlayer = db.prepare(`
    INSERT INTO players (name, team, role, external_player_id, sportmonks_player_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(external_player_id) DO UPDATE SET
      name = excluded.name, team = excluded.team
  `);
  const addToSquad = db.prepare(`
    INSERT INTO match_squads (match_id, player_id, is_playing_xi)
    VALUES (?, ?, 1)
    ON CONFLICT(match_id, player_id) DO UPDATE SET is_playing_xi = 1
  `);
  const upsertStat = db.prepare(`
    INSERT INTO player_match_stats
      (match_id, player_id, runs, balls_faced, fours, sixes, dismissal_type,
       overs_bowled, wickets, runs_conceded, maidens,
       catches, stumpings, run_outs, fantasy_points,
       bowler_name, catcher_name, runout_name, scoreboard, sort_order, is_active, batting_team_id, match_team,
       updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      runs           = excluded.runs,
      balls_faced    = excluded.balls_faced,
      fours          = excluded.fours,
      sixes          = excluded.sixes,
      dismissal_type = excluded.dismissal_type,
      overs_bowled   = excluded.overs_bowled,
      wickets        = excluded.wickets,
      runs_conceded  = excluded.runs_conceded,
      maidens        = excluded.maidens,
      catches        = excluded.catches,
      stumpings      = excluded.stumpings,
      run_outs       = excluded.run_outs,
      fantasy_points = excluded.fantasy_points,
      bowler_name    = excluded.bowler_name,
      catcher_name   = excluded.catcher_name,
      runout_name    = excluded.runout_name,
      batting_team_id = COALESCE(batting_team_id, excluded.batting_team_id),
      scoreboard     = excluded.scoreboard,
      sort_order     = excluded.sort_order,
      is_active      = excluded.is_active,
      updated_at     = datetime('now')
  `);

  const doUpsert = db.transaction((playerStats) => {
    for (const stat of playerStats) {
      const extId = String(stat.externalPlayerId);

      // Find player by external ID first
      let player = getPlayerByExternal.get(extId);

      // Fallback: match by name
      if (!player && stat.name) {
        const byName = getPlayerByName.get(stat.name);
        if (byName) {
          db.prepare('UPDATE players SET external_player_id = ?, sportmonks_player_id = ? WHERE id = ?')
            .run(extId, parseInt(extId) || null, byName.id);
          player = byName;
        }
      }

      // Create new player if still not found
      if (!player) {
        // Last resort: check match_squads for player with same name in this match
        if (stat.name) {
          const inSquad = db.prepare(`
            SELECT p.id FROM players p
            JOIN match_squads ms ON ms.player_id = p.id
            WHERE ms.match_id = ? AND LOWER(p.name) = LOWER(?)
          `).get(matchId, stat.name);
          if (inSquad) {
            // Update external_player_id to link scorecard → existing player
            db.prepare('UPDATE players SET external_player_id = ?, sportmonks_player_id = ? WHERE id = ?')
              .run(extId, parseInt(extId) || null, inSquad.id);
            // Never overwrite franchise team name with national team from scorecard
            player = inSquad;
          }
        }
        if (!player) {
          // Only set team on new players — don't overwrite franchise team with national team
          upsertPlayer.run(
            stat.name || `Player ${extId}`,
            stat.team || '',
            stat.role || 'batsman',
            extId,
            parseInt(extId) || null
          );
          player = getPlayerByExternal.get(extId);
          if (!player) continue;
        }
      }

      // Mark as playing XI
      addToSquad.run(matchId, player.id);

      // Always true for scorecard players
      const isPlayingXi = true;

      const { total: fantasyPoints } = calculateFantasyPoints(
        { ...stat, isPlayingXi },
        'normal',
        DEFAULT_SCORING_CONFIG
      );

      upsertStat.run(
        matchId, player.id,
        stat.runs, stat.ballsFaced, stat.fours, stat.sixes, stat.dismissalType,
        stat.oversBowled, stat.wickets, stat.runsConceded, stat.maidens,
        stat.catches, stat.stumpings, stat.runOuts,
        fantasyPoints,
        stat.bowlerName || null,
        stat.catcherName || null,
        stat.runoutName || null,
        stat.scoreboard || null,
        stat.sortOrder || 99,
        stat.active ? 1 : 0,
        (stat.battingTeamId != null && stat.battingTeamId !== undefined) ? stat.battingTeamId : null,
        stat.team || null
      );
    }
  });

  doUpsert(playerStats);
}

// ── Recompute all team fantasy points for a match ───────────────────────────
function recomputeTeamPoints(matchId) {
  const db = getDb();

  const userTeams = db.prepare(`
    SELECT id, resolved_captain_id, resolved_vice_captain_id, captain_id, vice_captain_id
    FROM user_teams WHERE match_id = ?
  `).all(matchId);

  const getPlayerStats = db.prepare(
    'SELECT pms.* FROM player_match_stats pms WHERE pms.match_id = ? AND pms.player_id = ?'
  );
  const getAllTeamPlayers = db.prepare(`
    SELECT utp.player_id, utp.is_backup, utp.backup_order
    FROM user_team_players utp WHERE utp.user_team_id = ?
    ORDER BY utp.is_backup ASC, utp.backup_order ASC
  `);
  const getSquadEntry = db.prepare(
    'SELECT is_playing_xi FROM match_squads WHERE match_id = ? AND player_id = ?'
  );
  const updateTeamPoints = db.prepare(
    'UPDATE user_teams SET total_fantasy_points = ? WHERE id = ?'
  );

  const recomputeAll = db.transaction(() => {
    for (const team of userTeams) {
      const captainId = team.resolved_captain_id || team.captain_id;
      const vcId      = team.resolved_vice_captain_id || team.vice_captain_id;
      const allPlayers  = getAllTeamPlayers.all(team.id);
      const mainPlayers = allPlayers.filter(p => !p.is_backup);
      const backupPlayers = allPlayers.filter(p => p.is_backup)
                                      .sort((a, b) => a.backup_order - b.backup_order);

      const activePlayers = [];
      const usedBackups   = new Set();

      for (const main of mainPlayers) {
        const squadEntry = getSquadEntry.get(matchId, main.player_id);
        const isPlaying  = squadEntry ? squadEntry.is_playing_xi === 1 : true;
        if (isPlaying) {
          activePlayers.push(main.player_id);
        } else {
          const backup = backupPlayers.find(b =>
            !usedBackups.has(b.player_id) &&
            (getSquadEntry.get(matchId, b.player_id)?.is_playing_xi === 1)
          );
          if (backup) {
            activePlayers.push(backup.player_id);
            usedBackups.add(backup.player_id);
          }
        }
      }

      let totalPoints = 0;
      for (const player_id of activePlayers) {
        const stats = getPlayerStats.get(matchId, player_id);
        if (!stats) continue;
        const role = player_id === captainId ? 'captain' : player_id === vcId ? 'vice_captain' : 'normal';
        const { total } = calculateFantasyPoints(
          {
            isPlayingXi:   true,
            runs:          stats.runs,
            ballsFaced:    stats.balls_faced,
            fours:         stats.fours,
            sixes:         stats.sixes,
            dismissalType: stats.dismissal_type,
            oversBowled:   stats.overs_bowled,
            wickets:       stats.wickets,
            runsConceded:  stats.runs_conceded,
            maidens:       stats.maidens,
            catches:       stats.catches,
            stumpings:     stats.stumpings,
            runOuts:       stats.run_outs,
          },
          role,
          DEFAULT_SCORING_CONFIG
        );
        totalPoints += total;
      }
      updateTeamPoints.run(totalPoints, team.id);
    }
  });

  recomputeAll();

  // Rank snapshots
  try {
    const teams = db.prepare(
      'SELECT ut.id, ut.total_fantasy_points FROM user_teams ut WHERE ut.match_id = ? ORDER BY ut.total_fantasy_points DESC'
    ).all(matchId);
    const match = db.prepare('SELECT last_ball_count FROM matches WHERE id = ?').get(matchId);
    const balls = match?.last_ball_count || 0;
    const over  = Math.round((balls / 6) * 10) / 10;
    const insertSnap = db.prepare(
      'INSERT INTO rank_snapshots (match_id, user_team_id, over, total_pts, rank) VALUES (?,?,?,?,?)'
    );
    const snapAll = db.transaction(() => {
      teams.forEach((t, i) => insertSnap.run(matchId, t.id, over, t.total_fantasy_points, i + 1));
    });
    snapAll();
  } catch {}
}

// ── Sync live match from Sportmonks ──────────────────────────────────────────
async function syncLiveMatch(matchId, sportmonksFixtureId) {
  const db = getDb();
  try {
    const { matchInfo, playerStats } = await sportmonks.fetchFixtureScorecard(sportmonksFixtureId);

    if (!playerStats || playerStats.length === 0) {
      console.log(`[syncLiveMatch] matchId=${matchId}: 0 players in scorecard`);
      return { success: false, error: 'No player stats' };
    }

    upsertStats(matchId, playerStats);

    // Give +4 to all confirmed XI players not yet in scorecard
    // (players who haven't batted/bowled yet still get playing XI bonus)
    const xiPlayers = db.prepare(
      'SELECT player_id FROM match_squads WHERE match_id = ? AND is_playing_xi = 1'
    ).all(matchId);
    const hasStats = db.prepare(
      'SELECT player_id FROM player_match_stats WHERE match_id = ?'
    ).all(matchId).map(r => r.player_id);
    const hasStatsSet = new Set(hasStats);

    const insertXiBonus = db.prepare(`
      INSERT INTO player_match_stats
        (match_id, player_id, runs, balls_faced, fours, sixes, dismissal_type,
         overs_bowled, wickets, runs_conceded, maidens,
         catches, stumpings, run_outs, fantasy_points, updated_at)
      VALUES (?, ?, 0, 0, 0, 0, 'dnb', 0, 0, 0, 0, 0, 0, 0, 4, datetime('now'))
      ON CONFLICT(match_id, player_id) DO NOTHING
    `);
    const addXiBonuses = db.transaction(() => {
      for (const { player_id } of xiPlayers) {
        if (!hasStatsSet.has(player_id)) {
          insertXiBonus.run(matchId, player_id);
        }
      }
    });
    addXiBonuses();

    recomputeTeamPoints(matchId);

    const newStatus = matchInfo.matchEnded ? 'completed' : 'live';
    // Store as JSON array for accurate frontend parsing
    const scoreStr = JSON.stringify(matchInfo.score.map(s => ({
      teamId:   s.teamId,
      teamName: s.teamName || (s.teamId === matchInfo.localTeamId ? matchInfo.teamA : matchInfo.teamB),
      r: s.r, w: s.w, o: s.o, inning: s.inning,
    })));

    db.prepare(`
      UPDATE matches SET status = ?, last_synced = datetime('now'), live_score = ? WHERE id = ?
    `).run(newStatus, scoreStr, matchId);

    console.log(`[syncLiveMatch] matchId=${matchId}: ${playerStats.length} players, status=${newStatus}`);
    return { success: true, status: newStatus, playersUpdated: playerStats.length };
  } catch (err) {
    console.error(`[syncLiveMatch] matchId=${matchId} error:`, err.message);
    return { success: false, error: err.message };
  }
}

// ── Upsert a match from Sportmonks fixture data ──────────────────────────────
function upsertMatch(seasonId, matchData) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM matches WHERE sportmonks_fixture_id = ?'
  ).get(matchData.sportmonksFixtureId);

  if (existing) return existing.id;

  // Use sportmonks fixture ID as external_match_id too
  const extId = `sm-${matchData.sportmonksFixtureId}`;
  const result = db.prepare(`
    INSERT INTO matches (season_id, external_match_id, sportmonks_fixture_id, sportmonks_season_id, localteam_id, visitorteam_id, team_a, team_b, venue, match_type, status, start_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)
  `).run(
    seasonId,
    extId,
    matchData.sportmonksFixtureId,
    matchData.sportmonksSeasonId || null,
    matchData.localteamId || null,
    matchData.visitorteamId || null,
    matchData.teamA,
    matchData.teamB,
    matchData.venue || '',
    matchData.matchType || 't20',
    matchData.startTime
  );
  return result.lastInsertRowid;
}

module.exports = {
  upsertMatch,
  upsertSquad,
  syncPlayingXi,
  upsertStats,
  recomputeTeamPoints,
  syncLiveMatch,
};
