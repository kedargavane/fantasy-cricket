'use strict';

const { getDb }              = require('../db/database');
const cricapi                = require('../api/cricapi');
const { calculateFantasyPoints } = require('../engines/scoringEngine');
const { resolveTeam }        = require('../engines/swapEngine');
const { DEFAULT_SCORING_CONFIG } = require('../engines/scoringConfig');

// ── Match sync ────────────────────────────────────────────────────────────────

/**
 * Upsert a match record from CricAPI data.
 */
function upsertMatch(seasonId, matchData) {
  const db = getDb();

  const existing = db.prepare(
    'SELECT id FROM matches WHERE external_match_id = ?'
  ).get(matchData.externalMatchId);

  if (existing) {
    db.prepare(`
      UPDATE matches SET
        status      = ?,
        last_synced = datetime('now')
      WHERE id = ?
    `).run(matchData.status, existing.id);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO matches
      (season_id, external_match_id, team_a, team_b, venue, match_type, status, start_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seasonId,
    matchData.externalMatchId,
    matchData.teamA,
    matchData.teamB,
    matchData.venue,
    matchData.matchType,
    matchData.status,
    matchData.startTime,
  );

  // Insert default match config
  db.prepare(
    'INSERT INTO match_config (match_id, entry_units) VALUES (?, 300)'
  ).run(result.lastInsertRowid);

  return result.lastInsertRowid;
}

// ── Squad sync ────────────────────────────────────────────────────────────────

/**
 * Upsert players and squad for a match.
 * Marks is_playing_xi based on confirmed XI from API.
 */
function upsertSquad(matchId, players) {
  const db = getDb();

  const upsertPlayer = db.prepare(`
    INSERT INTO players (name, team, role, external_player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(external_player_id) DO UPDATE SET
      name = excluded.name,
      team = excluded.team,
      role = excluded.role
  `);

  const upsertSquad = db.prepare(`
    INSERT INTO match_squads (match_id, player_id, is_playing_xi)
    VALUES (?, ?, ?)
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      is_playing_xi = excluded.is_playing_xi
  `);

  const getPlayer = db.prepare(
    'SELECT id FROM players WHERE external_player_id = ?'
  );

  const upsertMany = db.transaction((players) => {
    for (const p of players) {
      upsertPlayer.run(p.name, p.team, p.role, p.externalPlayerId);
      const player = getPlayer.get(p.externalPlayerId);
      upsertSquad.run(matchId, player.id, p.isPlayingXi ? 1 : 0);
    }
  });

  upsertMany(players);
}

// ── Stats sync ────────────────────────────────────────────────────────────────

/**
 * Upsert player match stats and recompute fantasy points.
 * Called every 60s during live matches.
 */
function upsertStats(matchId, playerStats) {
  const db = getDb();

  const getPlayer = db.prepare(
    'SELECT id FROM players WHERE external_player_id = ?'
  );

  const getSquadEntry = db.prepare(
    'SELECT is_playing_xi FROM match_squads WHERE match_id = ? AND player_id = ?'
  );

  const upsertStat = db.prepare(`
    INSERT INTO player_match_stats
      (match_id, player_id, runs, balls_faced, fours, sixes, dismissal_type,
       overs_bowled, wickets, runs_conceded, maidens,
       catches, stumpings, run_outs, fantasy_points, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      updated_at     = datetime('now')
  `);

  const upsertPlayer = db.prepare(`
    INSERT INTO players (name, team, role, external_player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(external_player_id) DO UPDATE SET
      name = excluded.name, team = excluded.team
  `);

  const addToSquad = db.prepare(`
    INSERT INTO match_squads (match_id, player_id, is_playing_xi)
    VALUES (?, ?, 1)
    ON CONFLICT(match_id, player_id) DO UPDATE SET is_playing_xi = 1
  `);

  const doUpsert = db.transaction((playerStats) => {
    for (const stat of playerStats) {
      // Try to find player by external ID first
      let player = getPlayer.get(stat.externalPlayerId);

      // If not found by ID — try to find by name (squad/scorecard use different IDs)
      if (!player) {
        const byName = db.prepare(
          "SELECT id FROM players WHERE LOWER(name) = LOWER(?)"
        ).get(stat.name);
        if (byName) {
          // Update existing player's external ID to the scorecard ID so future lookups work
          db.prepare('UPDATE players SET external_player_id = ? WHERE id = ?')
            .run(stat.externalPlayerId, byName.id);
          player = byName;
          console.log(`[upsertStats] Matched ${stat.name} by name, updated external_player_id`);
        }
      }

      // Still not found — create new player and add to squad
      if (!player) {
        upsertPlayer.run(stat.name, stat.team, stat.role || 'batsman', stat.externalPlayerId);
        player = getPlayer.get(stat.externalPlayerId);
        if (!player) continue;
        addToSquad.run(matchId, player.id);
        console.log(`[upsertStats] Auto-added new player ${stat.name} to match ${matchId} squad`);
      }

      // Mark as playing XI since they appeared in scorecard
      addToSquad.run(matchId, player.id);

      // All players appearing in scorecard are playing XI — don't read back from DB
      // (DB write via addToSquad may not be visible in same transaction)
      const isPlayingXi = true;

      // Compute fantasy points (role is 'normal' here — multipliers applied at team scoring)
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
        fantasyPoints
      );
    }
  });

  doUpsert(playerStats);
}

// ── Auto-swap processor ───────────────────────────────────────────────────────

/**
 * Run auto-swap for all user teams in a match.
 * Called once when match status flips to 'live'.
 */
function processAutoSwaps(matchId) {
  const db = getDb();

  // Get confirmed Playing XI player IDs
  const xiPlayers = db.prepare(`
    SELECT player_id FROM match_squads
    WHERE match_id = ? AND is_playing_xi = 1
  `).all(matchId);

  const playingXiIds = new Set(xiPlayers.map(r => r.player_id));

  // Get all user teams for this match that haven't been swap-processed
  const userTeams = db.prepare(`
    SELECT id, user_id, captain_id, vice_captain_id
    FROM user_teams
    WHERE match_id = ? AND swap_processed_at IS NULL AND locked_at IS NOT NULL
  `).all(matchId);

  const getTeamPlayers = db.prepare(`
    SELECT p.id, p.name, utp.is_backup, utp.backup_order
    FROM user_team_players utp
    JOIN players p ON p.id = utp.player_id
    WHERE utp.user_team_id = ?
    ORDER BY utp.is_backup ASC, utp.backup_order ASC
  `);

  const updateResolved = db.prepare(`
    UPDATE user_teams SET
      resolved_captain_id      = ?,
      resolved_vice_captain_id = ?,
      swap_processed_at        = datetime('now')
    WHERE id = ?
  `);

  const insertSwapLog = db.prepare(`
    INSERT INTO user_team_swaps
      (user_team_id, swapped_out_player_id, swapped_in_player_id, inherited_role)
    VALUES (?, ?, ?, ?)
  `);

  const processAll = db.transaction(() => {
    for (const team of userTeams) {
      const allPlayers = getTeamPlayers.all(team.id);
      const mainPlayers = allPlayers.filter(p => !p.is_backup);
      const backups     = allPlayers.filter(p => p.is_backup).sort((a, b) => a.backup_order - b.backup_order);

      const resolved = resolveTeam(
        {
          mainPlayers,
          backups,
          captainId:     team.captain_id,
          viceCaptainId: team.vice_captain_id,
        },
        playingXiIds
      );

      updateResolved.run(
        resolved.captainId,
        resolved.viceCaptainId,
        team.id
      );

      for (const swap of resolved.swapLog) {
        if (swap.type === 'swapped') {
          insertSwapLog.run(
            team.id,
            swap.swappedOut.id,
            swap.swappedIn.id,
            swap.inheritedRole
          );
        }
      }
    }
  });

  processAll();

  return userTeams.length;
}

// ── Team fantasy points recompute ─────────────────────────────────────────────

/**
 * Recompute total fantasy points for all user teams in a match.
 * Called after each stats sync during live matches.
 */
function recomputeTeamPoints(matchId) {
  const db = getDb();

  const userTeams = db.prepare(`
    SELECT id, resolved_captain_id, resolved_vice_captain_id, captain_id, vice_captain_id
    FROM user_teams
    WHERE match_id = ?
  `).all(matchId);

  const getPlayerStats = db.prepare(`
    SELECT pms.* FROM player_match_stats pms
    WHERE pms.match_id = ? AND pms.player_id = ?
  `);



  // Fetch ALL players for a team (main + backup) so we can resolve swaps
  const getAllTeamPlayers = db.prepare(`
    SELECT utp.player_id, utp.is_backup, utp.backup_order
    FROM user_team_players utp
    WHERE utp.user_team_id = ?
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
      const captainId = team.resolved_captain_id     || team.captain_id;
      const vcId      = team.resolved_vice_captain_id || team.vice_captain_id;
      const allPlayers = getAllTeamPlayers.all(team.id);

      const mainPlayers   = allPlayers.filter(p => !p.is_backup);
      const backupPlayers = allPlayers.filter(p =>  p.is_backup)
                                      .sort((a, b) => a.backup_order - b.backup_order);

      // Build active XI: main players who played, or their backup replacement
      const activePlayers = [];
      const usedBackups   = new Set();

      for (const main of mainPlayers) {
        const squadEntry  = getSquadEntry.get(matchId, main.player_id);
        const isPlaying   = squadEntry ? squadEntry.is_playing_xi === 1 : true;

        if (isPlaying) {
          activePlayers.push(main.player_id);
        } else {
          // Find next available backup who is playing
          const backup = backupPlayers.find(b =>
            !usedBackups.has(b.player_id) &&
            (getSquadEntry.get(matchId, b.player_id)?.is_playing_xi === 1)
          );
          if (backup) {
            activePlayers.push(backup.player_id);
            usedBackups.add(backup.player_id);
          }
          // If no backup available, main gets 0 pts (not playing XI)
        }
      }

      let totalPoints = 0;

      for (const player_id of activePlayers) {
        const stats = getPlayerStats.get(matchId, player_id);
        if (!stats) continue;

        const role =
          player_id === captainId ? 'captain'      :
          player_id === vcId      ? 'vice_captain' :
          'normal';

        const { total } = calculateFantasyPoints(
          {
            isPlayingXi:   true, // only active players reach here
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

  // Snapshot current rankings for trajectory chart
  try {
    const db2 = getDb();
    const teams = db2.prepare(
      'SELECT ut.id, ut.total_fantasy_points FROM user_teams ut WHERE ut.match_id = ? ORDER BY ut.total_fantasy_points DESC'
    ).all(matchId);

    // Get current over from match_info ball count (stored in match)
    const match = db2.prepare('SELECT last_ball_count FROM matches WHERE id = ?').get(matchId);
    const balls = match?.last_ball_count || 0;
    const over  = Math.round((balls / 6) * 10) / 10;

    const insertSnap = db2.prepare(
      'INSERT INTO rank_snapshots (match_id, user_team_id, over, total_pts, rank) VALUES (?,?,?,?,?)'
    );
    const snapAll = db2.transaction(() => {
      teams.forEach((t, i) => insertSnap.run(matchId, t.id, over, t.total_fantasy_points, i + 1));
    });
    snapAll();

    // 💉 Injection detection — compare with previous snapshot
    try {
      const prevSnaps = db2.prepare(`
        SELECT rs.user_team_id, rs.rank, u.name, u.id as user_id
        FROM rank_snapshots rs
        JOIN user_teams ut ON ut.id = rs.user_team_id
        JOIN users u ON u.id = ut.user_id
        WHERE rs.match_id = ?
        AND rs.id NOT IN (SELECT id FROM rank_snapshots WHERE match_id = ? ORDER BY id DESC LIMIT ?)
        ORDER BY rs.id DESC
        LIMIT ?
      `).all(matchId, matchId, teams.length, teams.length);

      // Build previous rank map
      const prevRankMap = {};
      for (const p of prevSnaps) prevRankMap[p.user_team_id] = { rank: p.rank, name: p.name, user_id: p.user_id };

      // Detect injections — someone moved down
      teams.forEach((t, i) => {
        const newRank = i + 1;
        const prev = prevRankMap[t.id];
        if (prev && newRank > prev.rank) {
          // This user got injected! (moved down)
          console.log(`[injection] 💉 ${prev.name} dropped from #${prev.rank} to #${newRank}`);
          // Emit to socket for push notification
          try {
            const { getIo } = require('../server');
            const io = getIo();
            if (io) {
              io.to(`match:${matchId}`).emit('injection', {
                matchId,
                userId: prev.user_id,
                userName: prev.name,
                fromRank: prev.rank,
                toRank: newRank,
              });
            }
          } catch {}
        }
      });
    } catch {}
  } catch (e) {
    // Non-critical — don't fail recompute if snapshot fails
  }
}

// ── Sync Playing XI from match_xi endpoint ───────────────────────────────────
/**
 * Fetches confirmed Playing XI from CricAPI and updates is_playing_xi
 * in match_squads. Marks non-XI players as false.
 * Called by cron ~1hr before match and repeated until XI confirmed.
 */
async function syncPlayingXi(matchId, externalMatchId) {
  const db = getDb();
  try {
    const { fetchMatchXi } = require('./cricapi');
    const xiPlayers = await fetchMatchXi(externalMatchId);

    if (!xiPlayers || xiPlayers.length === 0) {
      return { success: false, reason: 'XI not announced yet' };
    }

    // Get all players in the squad by external ID
    const squadPlayers = db.prepare(`
      SELECT p.id, p.external_player_id
      FROM match_squads ms
      JOIN players p ON p.id = ms.player_id
      WHERE ms.match_id = ?
    `).all(matchId);

    // Build set of confirmed XI external IDs
    const xiIds = new Set(xiPlayers.map(p => p.id.toLowerCase()));

    // Update is_playing_xi for each squad player
    const updateXi = db.prepare(
      'UPDATE match_squads SET is_playing_xi = ? WHERE match_id = ? AND player_id = ?'
    );

    const updateAll = db.transaction(() => {
      for (const sp of squadPlayers) {
        const extId = (sp.external_player_id || '').toLowerCase();
        const isXi  = xiIds.has(extId) ? 1 : 0;
        updateXi.run(isXi, matchId, sp.id);
      }
    });

    updateAll();

    console.log(`[syncXi] Match ${matchId}: ${xiPlayers.length} XI players confirmed`);
    return { success: true, xiCount: xiPlayers.length };
  } catch (err) {
    console.error(`[syncXi] Match ${matchId} error:`, err.message);
    return { success: false, reason: err.message };
  }
}

// ── Full live sync (called by cron) ───────────────────────────────────────────

/**
 * Full sync cycle for a single live match.
 * 1. Fetch scorecard from API
 * 2. Upsert stats
 * 3. Recompute team points
 * 4. Update match status
 */
async function syncLiveMatch(matchId, externalMatchId) {
  const db = getDb();

  try {
    const match = db.prepare('SELECT team_a, team_b FROM matches WHERE id = ?').get(matchId);
    const { matchInfo, playerStats } = await cricapi.fetchMatchScorecard(externalMatchId, match?.team_a, match?.team_b);

    if (!playerStats || playerStats.length === 0) {
      console.log(`[syncLiveMatch] matchId=${matchId}: scorecard returned 0 players, skipping`);
      return { success: false, error: 'No player stats in scorecard' };
    }

    // Upsert stats
    upsertStats(matchId, playerStats);

    // Recompute all team points
    recomputeTeamPoints(matchId);

    // Update match status, last_synced and live score
    const newStatus = matchInfo.matchEnded ? 'completed' : 'live';
    const scoreStr = (matchInfo.score || []).map(s => 
      `${s.inning?.replace(/\s+Inning\s+\d+/i,'').trim() || ''} ${s.r}/${s.w} (${s.o})`
    ).join(' | ');
    db.prepare(`
      UPDATE matches SET status = ?, last_synced = datetime('now'), live_score = ? WHERE id = ?
    `).run(newStatus, scoreStr, matchId);

    console.log(`[syncLiveMatch] matchId=${matchId}: ${playerStats.length} players synced, status=${newStatus}`);
    return { success: true, status: newStatus, playersUpdated: playerStats.length };
  } catch (err) {
    console.error(`[syncLiveMatch] matchId=${matchId} error:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  upsertMatch,
  upsertSquad,
  syncPlayingXi,
  upsertStats,
  processAutoSwaps,
  recomputeTeamPoints,
  syncLiveMatch,
};
