'use strict';

const express = require('express');
const { getDb }                  = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upsertMatch, upsertSquad, recomputeTeamPoints } = require('../api/syncService');
const cricketdata                = require('../api/cricketdata');
const { distributePrizes }       = require('../engines/prizeEngine');
const { sendMatchReminders }     = require('../jobs/cronJobs');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// ════════════════════════════════════════════════════════
// SEASONS
// ════════════════════════════════════════════════════════

// ── POST /api/admin/seasons/:id/sync-members ─────────────────────────────────
// Adds ALL registered users to a season — safe to run multiple times
router.post('/seasons/:id/sync-members', (req, res) => {
  const db       = getDb();
  const seasonId = parseInt(req.params.id, 10);

  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const users = db.prepare('SELECT id FROM users').all();
  let added = 0;

  const sync = db.transaction(() => {
    for (const u of users) {
      const existing = db.prepare('SELECT id FROM season_memberships WHERE season_id=? AND user_id=?').get(seasonId, u.id);
      if (!existing) {
        db.prepare('INSERT INTO season_memberships (season_id,user_id) VALUES (?,?)').run(seasonId, u.id);
        db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id,user_id) VALUES (?,?)').run(seasonId, u.id);
        added++;
      } else {
        db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id,user_id) VALUES (?,?)').run(seasonId, u.id);
      }
    }
  });

  sync();
  return res.json({ message: `Synced ${users.length} users, added ${added} new members`, total: users.length });
});

// ── GET /api/admin/seasons ────────────────────────────────────────────────────
router.get('/seasons', (req, res) => {
  const db = getDb();
  const seasons = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM season_memberships WHERE season_id = s.id) as member_count,
      (SELECT COUNT(*) FROM matches WHERE season_id = s.id) as match_count
    FROM seasons s
    ORDER BY s.created_at DESC
  `).all();
  return res.json({ seasons });
});

// ── POST /api/admin/seasons ───────────────────────────────────────────────────
router.post('/seasons', (req, res) => {
  const { name, year, maxPlayers } = req.body;
  if (!name || !year) return res.status(400).json({ error: 'name and year are required' });

  const db          = getDb();
  const inviteCode  = generateInviteCode();

  const result = db.prepare(`
    INSERT INTO seasons (name, year, status, invite_code, admin_user_id, max_players)
    VALUES (?, ?, 'upcoming', ?, ?, ?)
  `).run(name, year, inviteCode, req.user.id, maxPlayers || 20);

  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ season });
});

// ── PATCH /api/admin/seasons/:id ──────────────────────────────────────────────
router.patch('/seasons/:id', (req, res) => {
  const db = getDb();
  const { status, maxPlayers, inviteCode, seriesIds } = req.body;

  if (status && !['upcoming','active','completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const fields = [];
  const values = [];
  if (status)                  { fields.push('status = ?');      values.push(status); }
  if (maxPlayers)              { fields.push('max_players = ?'); values.push(maxPlayers); }
  if (inviteCode)              { fields.push('invite_code = ?'); values.push(inviteCode); }
  if (seriesIds !== undefined) { fields.push('series_ids = ?'); values.push(JSON.stringify(seriesIds)); }

  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.params.id);
  db.prepare(`UPDATE seasons SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  return res.json({ season });
});


// ── POST /api/admin/seasons/:id/members ───────────────────────────────────────
router.post('/seasons/:id/members', (req, res) => {
  const db       = getDb();
  const seasonId = parseInt(req.params.id, 10);
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, userId);
  if (existing) return res.status(409).json({ error: 'User is already a member of this season' });

  db.transaction(() => {
    db.prepare('INSERT INTO season_memberships (season_id, user_id) VALUES (?, ?)').run(seasonId, userId);
    db.prepare(`
      INSERT INTO season_leaderboard (season_id, user_id, total_fantasy_points, total_units_won, net_units, matches_played, top_finishes)
      VALUES (?, ?, 0, 0, 0, 0, 0)
    `).run(seasonId, userId);
  })();

  return res.json({ success: true });
});

// ── POST /api/admin/seasons/:id/sync-schedule ─────────────────────────────────
// Manually trigger auto-schedule for a specific season
router.post('/seasons/:id/sync-schedule', async (req, res) => {
  const db = getDb();
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (!season.series_ids || season.series_ids === '[]') {
    return res.status(400).json({ error: 'No series IDs configured for this season. Add them first.' });
  }

  return res.json({ message: 'Auto-schedule removed. Use Admin → Discover to import fixtures via Sportmonks.' });
});

// ── GET /api/admin/discover ──────────────────────────────────────────────────
// Redirect to series import page
router.get('/discover', async (req, res) => {
  return res.json({ message: 'Use POST /admin/series/preview and /admin/series/import instead' });
});

// ── POST /api/admin/discover/approve ─────────────────────────────────────────
// Approve a match (CricketData UUID) into the season
router.post('/discover/approve', async (req, res) => {
  const db = getDb();
  const { seasonId, externalMatchId, teamA, teamB, venue, matchType, startTime, entryUnits } = req.body;

  if (!seasonId || !externalMatchId || !teamA || !teamB || !startTime) {
    return res.status(400).json({ error: 'seasonId, externalMatchId, teamA, teamB, startTime required' });
  }

  // Check not already added (externalMatchId stored in both columns)
  const existing = db.prepare(
    'SELECT id FROM matches WHERE external_match_id = ? OR sportmonks_fixture_id = ?'
  ).get(externalMatchId, externalMatchId);
  if (existing) {
    return res.status(400).json({ error: 'Match already added to this season', matchId: existing.id });
  }

  const matchId = upsertMatch(seasonId, {
    externalMatchId, teamA, teamB,
    venue: venue || '',
    matchType: matchType || 't20',
    status: 'upcoming',
    startTime,
  });

  if (entryUnits && entryUnits !== 300) {
    db.prepare('UPDATE match_config SET entry_units = ? WHERE match_id = ?').run(entryUnits, matchId);
  }

  // Squad will be synced automatically by hourly cron via Sportmonks

  const match = db.prepare('SELECT m.*, mc.entry_units FROM matches m LEFT JOIN match_config mc ON mc.match_id = m.id WHERE m.id = ?').get(matchId);
  return res.status(201).json({ message: 'Match approved and added to season', match });
});

// ── POST /api/admin/matches/:id/sync-scorecard ───────────────────────────────
// Accepts raw CricAPI scorecard JSON pushed from local Mac poller
// Bypasses Railway→CricAPI network issues
router.post('/matches/:id/sync-scorecard', async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const scorecardData = req.body;

  if (!scorecardData || !scorecardData.data) {
    return res.status(400).json({ error: 'Raw CricAPI scorecard data required' });
  }

  try {
    const { upsertStats } = require('../api/syncService');


    const playerStats = extractPlayerStats(scorecardData.data);
    if (playerStats.length === 0) {
      return res.json({ message: 'No stats extracted yet', playerStats: 0 });
    }

    upsertStats(matchId, playerStats);
    const { recomputeTeamPoints } = require('../api/syncService');
    recomputeTeamPoints(matchId);

    // Update last_synced
    db.prepare("UPDATE matches SET last_synced = datetime('now') WHERE id = ?").run(matchId);

    // Check if match ended
    const matchEnded = scorecardData.data?.matchEnded || false;
    if (matchEnded) {
      db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").run(matchId);
    }

    return res.json({ 
      message: 'Scorecard synced', 
      playersUpdated: playerStats.length,
      matchEnded 
    });
  } catch (err) {
    console.error('[sync-scorecard]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/matches/:id/process-swaps ────────────────────────────────
// Force re-process auto-swaps for all teams in a match
// Resets swap_processed_at so swaps run again with current XI data
router.post('/matches/:id/process-swaps', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  // Reset swap_processed_at so processAutoSwaps runs again
  db.prepare('UPDATE user_teams SET swap_processed_at = NULL WHERE match_id = ?').run(matchId);

  // Re-run swaps
  const { processAutoSwaps, recomputeTeamPoints } = require('../api/syncService');
  const swapped = processAutoSwaps(matchId);
  recomputeTeamPoints(matchId);

  return res.json({ message: `Swaps reprocessed for ${swapped} teams`, matchId });
});

// ════════════════════════════════════════════════════════
// MATCHES
// ════════════════════════════════════════════════════════

// ── GET /api/admin/matches ────────────────────────────────────────────────────
router.get('/matches', (req, res) => {
  const db = getDb();
  const { seasonId } = req.query;

  let query = `
    SELECT m.*,
      mc.entry_units,
      (SELECT COUNT(*) FROM user_teams WHERE match_id = m.id) as team_count,
      (SELECT COUNT(*) FROM match_squads WHERE match_id = m.id AND is_playing_xi = 1) as xi_count
    FROM matches m
    LEFT JOIN match_config mc ON mc.match_id = m.id
  `;
  const params = [];
  if (seasonId) { query += ' WHERE m.season_id = ?'; params.push(seasonId); }
  query += ' ORDER BY m.start_time ASC';

  const matches = db.prepare(query).all(...params);
  return res.json({ matches });
});

// ── POST /api/admin/matches ───────────────────────────────────────────────────
// externalMatchId = CricketData UUID; seriesId = CricketData series UUID (informational)
router.post('/matches', (req, res) => {
  const { seasonId, externalMatchId, teamA, teamB, venue, matchType, startTime, entryUnits, seriesId } = req.body;

  if (!seasonId || !externalMatchId || !teamA || !teamB || !startTime) {
    return res.status(400).json({ error: 'seasonId, externalMatchId, teamA, teamB, startTime required' });
  }

  const db      = getDb();
  const matchId = upsertMatch(seasonId, {
    externalMatchId, teamA, teamB, venue: venue || '',
    matchType: matchType || 't20', status: 'upcoming', startTime,
  });

  // Override entry units if specified
  if (entryUnits && entryUnits !== 300) {
    db.prepare('UPDATE match_config SET entry_units = ? WHERE match_id = ?')
      .run(entryUnits, matchId);
  }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  return res.status(201).json({ match });
});

// ── PATCH /api/admin/matches/:id ──────────────────────────────────────────────
router.patch('/matches/:id', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { status, startTime, entryUnits, team_a, team_b, venue_info, localteam_id, visitorteam_id } = req.body;

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (team_a) {
    db.prepare('UPDATE matches SET team_a = ? WHERE id = ?').run(team_a, matchId);
  }
  if (team_b) {
    db.prepare('UPDATE matches SET team_b = ? WHERE id = ?').run(team_b, matchId);
  }
  if (venue_info) {
    db.prepare('UPDATE matches SET venue_info = ? WHERE id = ?').run(venue_info, matchId);
  }
  if (status) {
    db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, matchId);
  }
  if (startTime) {
    db.prepare('UPDATE matches SET start_time = ? WHERE id = ?').run(startTime, matchId);
  }
  if (localteam_id) {
    db.prepare('UPDATE matches SET localteam_id = ? WHERE id = ?').run(localteam_id, matchId);
  }
  if (visitorteam_id) {
    db.prepare('UPDATE matches SET visitorteam_id = ? WHERE id = ?').run(visitorteam_id, matchId);
  }
  if (entryUnits) {
    db.prepare('INSERT INTO match_config (match_id, entry_units) VALUES (?, ?) ON CONFLICT(match_id) DO UPDATE SET entry_units = ?')
      .run(matchId, entryUnits, entryUnits);
  }

  const updated = db.prepare('SELECT m.*, mc.entry_units FROM matches m LEFT JOIN match_config mc ON mc.match_id = m.id WHERE m.id = ?').get(matchId);
  return res.json({ match: updated });
});

// ── POST /api/admin/matches/:id/squad ─────────────────────────────────────────
// Set the Playing XII (admin manually confirms from CricAPI data)
router.post('/matches/:id/squad', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { players } = req.body;

  // players = [{ externalPlayerId, name, team, role, isPlayingXi }]
  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'players array required' });
  }

  const playingXiCount = players.filter(p => p.isPlayingXi).length;
  if (playingXiCount > 22) {
    return res.status(400).json({ error: 'Cannot have more than 22 playing XI players (11 per team)' });
  }

  upsertSquad(matchId, players);

  const squad = db.prepare(`
    SELECT p.*, ms.is_playing_xi
    FROM match_squads ms JOIN players p ON p.id = ms.player_id
    WHERE ms.match_id = ?
    ORDER BY p.team, ms.is_playing_xi DESC
  `).all(matchId);

  return res.json({ squad, playingXiCount });
});

// ── POST /api/admin/matches/:id/cleanup-squad ───────────────────────────────
// Remove duplicate players created by scorecard auto-add, merge stats to original
router.post('/matches/:id/cleanup-squad', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);

  // Find players with duplicate names in this match's squad
  const dupes = db.prepare(`
    SELECT p.id, p.name, p.external_player_id,
           (SELECT id FROM players p2 WHERE LOWER(p2.name) = LOWER(p.name) AND p2.id < p.id LIMIT 1) as original_id
    FROM players p
    JOIN match_squads ms ON ms.player_id = p.id AND ms.match_id = ?
    WHERE EXISTS (
      SELECT 1 FROM players p2 WHERE LOWER(p2.name) = LOWER(p.name) AND p2.id < p.id
    )
  `).all(matchId);

  let merged = 0;
  for (const dupe of dupes) {
    if (!dupe.original_id) continue;
    // Move stats from dupe to original
    db.prepare(`
      INSERT INTO player_match_stats (match_id, player_id, runs, balls_faced, fours, sixes,
        dismissal_type, overs_bowled, wickets, runs_conceded, maidens, catches, stumpings,
        run_outs, fantasy_points, updated_at)
      SELECT match_id, ?, runs, balls_faced, fours, sixes, dismissal_type, overs_bowled,
        wickets, runs_conceded, maidens, catches, stumpings, run_outs, fantasy_points, updated_at
      FROM player_match_stats WHERE match_id = ? AND player_id = ?
      ON CONFLICT(match_id, player_id) DO UPDATE SET
        runs=excluded.runs, balls_faced=excluded.balls_faced, fours=excluded.fours,
        sixes=excluded.sixes, dismissal_type=excluded.dismissal_type,
        overs_bowled=excluded.overs_bowled, wickets=excluded.wickets,
        runs_conceded=excluded.runs_conceded, maidens=excluded.maidens,
        fantasy_points=excluded.fantasy_points, updated_at=excluded.updated_at
    `).run(dupe.original_id, matchId, dupe.id);

    // Remove dupe from squad and stats
    db.prepare('DELETE FROM match_squads WHERE match_id = ? AND player_id = ?').run(matchId, dupe.id);
    db.prepare('DELETE FROM player_match_stats WHERE match_id = ? AND player_id = ?').run(matchId, dupe.id);
    merged++;
    console.log(`[cleanup] Merged ${dupe.name} (id=${dupe.id}) → id=${dupe.original_id}`);
  }

  // Recompute after cleanup
  const { recomputeTeamPoints } = require('../api/syncService');
  recomputeTeamPoints(matchId);

  return res.json({ message: `Merged ${merged} duplicate players`, merged });
});

// ── POST /api/admin/seasons/:seasonId/sync-venues ───────────────────────────
// Fetch venue + toss info for all matches in a season via CricketData match_info
router.post('/seasons/:seasonId/sync-venues', async (req, res) => {
  const db       = getDb();
  const seasonId = parseInt(req.params.seasonId, 10);
  const matches  = db.prepare('SELECT * FROM matches WHERE season_id = ?').all(seasonId);
  const cricketdata = require('../api/cricketdata');
  const results  = [];

  for (const match of matches) {
    if (!match.sportmonks_fixture_id) continue;
    try {
      const info = await cricketdata.fetchMatchInfo(match.sportmonks_fixture_id);
      const venueInfo = info.venueInfo || null;
      const tossInfo  = info.tossInfo  || null;
      db.prepare('UPDATE matches SET venue_info = ?, toss_info = COALESCE(toss_info, ?) WHERE id = ?')
        .run(venueInfo, tossInfo, match.id);
      results.push({ id: match.id, venue: venueInfo, toss: tossInfo });
    } catch (e) {
      results.push({ id: match.id, error: e.message });
    }
  }
  return res.json({ updated: results.length, results });
});

// ── POST /api/admin/matches/:id/sync-live ────────────────────────────────────
// Manually trigger a live scorecard sync for a match (uses Sportmonks)
router.post('/matches/:id/sync-live', async (req, res) => {
  const matchId = parseInt(req.params.id, 10);
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!match.sportmonks_fixture_id) return res.status(400).json({ error: 'No match ID (sportmonks_fixture_id) for this match' });

  try {
    const { syncLiveMatch } = require('../api/syncService');
    const result = await syncLiveMatch(matchId, match.sportmonks_fixture_id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/matches/:id/sync-squad-from/:sourceMatchId ───────────────
// Copy squad from another CricketData match UUID into this match's squad
router.post('/matches/:id/sync-squad-from/:sourceMatchId', async (req, res) => {
  const db           = getDb();
  const matchId      = parseInt(req.params.id, 10);
  const sourceMatchId = req.params.sourceMatchId;  // CricketData UUID string

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  try {
    const cricketdata = require('../api/cricketdata');
    const players     = await cricketdata.fetchMatchSquad(sourceMatchId);
    if (players.length === 0) return res.status(400).json({ error: 'No squad found in source match' });

    upsertSquad(matchId, players);

    const squad = db.prepare(`
      SELECT p.*, ms.is_playing_xi FROM match_squads ms
      JOIN players p ON p.id = ms.player_id WHERE ms.match_id = ?
      ORDER BY p.team, p.name
    `).all(matchId);

    return res.json({ synced: players.length, squad });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/matches/:id/sync-squad ───────────────────────────────────
router.post('/matches/:id/sync-squad', async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare(`
    SELECT m.*, s.series_ids FROM matches m
    LEFT JOIN seasons s ON s.id = m.season_id
    WHERE m.id = ?
  `).get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const externalId = match.external_match_id || match.sportmonks_fixture_id;
  if (!externalId) return res.status(400).json({ error: 'No external match ID for this match' });

  try {
    // fetchMatchSquad already falls back to series_squad internally
    let players = await cricketdata.fetchMatchSquad(externalId);

    // Final fallback: try first series ID from the season
    if (!players.length) {
      const seriesIds = JSON.parse(match.series_ids || '[]');
      if (seriesIds.length > 0) {
        players = await cricketdata.fetchSeriesSquad(seriesIds[0]);
      }
    }

    if (!players.length) {
      return res.json({ success: false, reason: 'Squad not yet available from CricketData' });
    }

    upsertSquad(matchId, players);
    return res.json({ success: true, count: players.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/matches/:id/seed-squad ───────────────────────────────────
router.post('/matches/:id/seed-squad', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { players } = req.body;

  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'players array is required' });
  }

  const match = db.prepare('SELECT id FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  upsertSquad(matchId, players);
  return res.json({ success: true, count: players.length });
});

// ── POST /api/admin/matches/:id/playing-xi ────────────────────────────────────
// Manually set Playing XI by external player IDs
router.post('/matches/:id/playing-xi', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { externalPlayerIds } = req.body;

  if (!Array.isArray(externalPlayerIds) || externalPlayerIds.length === 0) {
    return res.status(400).json({ error: 'externalPlayerIds array is required' });
  }

  db.prepare('UPDATE match_squads SET is_playing_xi = 0 WHERE match_id = ?').run(matchId);

  let updated = 0;
  for (const uuid of externalPlayerIds) {
    const player = db.prepare('SELECT id FROM players WHERE external_player_id = ?').get(uuid);
    if (player) {
      db.prepare('UPDATE match_squads SET is_playing_xi = 1 WHERE match_id = ? AND player_id = ?')
        .run(matchId, player.id);
      updated++;
    }
  }

  return res.json({ success: true, updated });
});

// ── POST /api/admin/matches/:id/stats/override ────────────────────────────────
// Manually override a player's stats (admin correction)
router.post('/matches/:id/stats/override', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { playerId, stats } = req.body;

  if (!playerId || !stats) {
    return res.status(400).json({ error: 'playerId and stats required' });
  }

  const { calculateFantasyPoints } = require('../engines/scoringEngine');
  const { DEFAULT_SCORING_CONFIG } = require('../engines/scoringConfig');

  const squadEntry = db.prepare(
    'SELECT is_playing_xi FROM match_squads WHERE match_id = ? AND player_id = ?'
  ).get(matchId, playerId);

  const isPlayingXi = squadEntry ? squadEntry.is_playing_xi === 1 : false;
  const { total: fantasyPoints } = calculateFantasyPoints(
    { ...stats, isPlayingXi }, 'normal', DEFAULT_SCORING_CONFIG
  );

  db.prepare(`
    INSERT INTO player_match_stats
      (match_id, player_id, runs, balls_faced, fours, sixes, dismissal_type,
       overs_bowled, wickets, runs_conceded, maidens,
       catches, stumpings, run_outs, fantasy_points, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      runs = excluded.runs, balls_faced = excluded.balls_faced,
      fours = excluded.fours, sixes = excluded.sixes,
      dismissal_type = excluded.dismissal_type,
      overs_bowled = excluded.overs_bowled, wickets = excluded.wickets,
      runs_conceded = excluded.runs_conceded, maidens = excluded.maidens,
      catches = excluded.catches, stumpings = excluded.stumpings,
      run_outs = excluded.run_outs, fantasy_points = excluded.fantasy_points,
      updated_at = datetime('now')
  `).run(
    matchId, playerId,
    stats.runs || 0, stats.ballsFaced || 0, stats.fours || 0, stats.sixes || 0,
    stats.dismissalType || 'notout',
    stats.oversBowled || 0, stats.wickets || 0, stats.runsConceded || 0, stats.maidens || 0,
    stats.catches || 0, stats.stumpings || 0, stats.runOuts || 0,
    fantasyPoints
  );

  recomputeTeamPoints(matchId);
  return res.json({ message: 'Stats overridden and teams recomputed', fantasyPoints });
});

// ── POST /api/admin/matches/:id/finalise ──────────────────────────────────────
// Finalise a match: lock scores, distribute prizes, update season leaderboard
router.post('/matches/:id/finalise', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status === 'upcoming') {
    return res.status(400).json({ error: 'Match has not started yet' });
  }

  // Pre-flight checks
  const xiCount = db.prepare(
    'SELECT COUNT(*) as count FROM match_squads WHERE match_id = ? AND is_playing_xi = 1'
  ).get(matchId).count;

  const statsCount = db.prepare(
    'SELECT COUNT(*) as count FROM player_match_stats WHERE match_id = ?'
  ).get(matchId).count;

  if (xiCount === 0) {
    return res.status(400).json({ error: 'Playing XI not set — cannot finalise' });
  }
  if (statsCount === 0) {
    return res.status(400).json({ error: 'No player stats found — cannot finalise' });
  }

  try {
    finaliseMatch(db, matchId, match.season_id);
    const result = db.prepare('SELECT * FROM match_prize_pools WHERE match_id = ?').get(matchId);
    return res.json({ message: 'Match finalised successfully', prizePool: result });
  } catch (err) {
    console.error('[admin/finalise]', err.message);
    return res.status(500).json({ error: `Finalisation failed: ${err.message}` });
  }
});

// ── POST /api/admin/matches/:id/cancel ───────────────────────────────────────
// Cancels a match and refunds entry units — allowed for any status (rain/abandonment)
router.post('/matches/:id/cancel', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT m.*, mc.entry_units FROM matches m LEFT JOIN match_config mc ON mc.match_id = m.id WHERE m.id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const entryUnits = match.entry_units || 300;

  try {
    // Old DBs have CHECK (status IN ('upcoming','live','completed','abandoned')) without 'cancelled'
    db.pragma('ignore_check_constraints = 1');

    const cancel = db.transaction(() => {
      db.prepare("UPDATE matches SET status = 'cancelled' WHERE id = ?").run(matchId);

      // Refund entry units to every participant
      const userTeams = db.prepare('SELECT id, user_id FROM user_teams WHERE match_id = ?').all(matchId);
      for (const ut of userTeams) {
        db.prepare('UPDATE user_teams SET units_won = ? WHERE id = ?').run(entryUnits, ut.id);
      }

      // Recompute season leaderboard from scratch (excluding this now-cancelled match)
      recomputeSeasonLeaderboard(db, match.season_id);
    });

    cancel();
    const refunded = db.prepare('SELECT COUNT(*) as c FROM user_teams WHERE match_id = ?').get(matchId).c;
    return res.json({ success: true, refunded });
  } catch (err) {
    console.error('[cancelMatch] DB error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    db.pragma('ignore_check_constraints = 0');
  }
});

// ── POST /api/admin/seasons/:id/recompute-leaderboard ────────────────────────
router.post('/seasons/:id/recompute-leaderboard', (req, res) => {
  const db       = getDb();
  const seasonId = parseInt(req.params.id, 10);
  try {
    recomputeSeasonLeaderboard(db, seasonId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[recomputeLeaderboard] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function recomputeSeasonLeaderboard(db, seasonId) {
  // Zero out everyone in the season
  db.prepare(`
    UPDATE season_leaderboard SET
      total_fantasy_points = 0,
      total_units_won      = 0,
      net_units            = 0,
      matches_played       = 0,
      top_finishes         = 0,
      updated_at           = datetime('now')
    WHERE season_id = ?
  `).run(seasonId);

  // Re-add contributions from every finalised non-cancelled match in this season
  const pools = db.prepare(`
    SELECT mpp.id as pool_id
    FROM match_prize_pools mpp
    JOIN matches m ON m.id = mpp.match_id
    WHERE m.season_id = ? AND mpp.is_finalized = 1 AND m.status != 'cancelled'
  `).all(seasonId);

  const upsert = db.prepare(`
    INSERT INTO season_leaderboard (season_id, user_id, total_fantasy_points, total_units_won, net_units, matches_played, top_finishes, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      total_fantasy_points = total_fantasy_points + excluded.total_fantasy_points,
      total_units_won      = total_units_won      + excluded.total_units_won,
      net_units            = net_units            + excluded.net_units,
      matches_played       = matches_played       + 1,
      top_finishes         = top_finishes         + excluded.top_finishes,
      updated_at           = datetime('now')
  `);

  for (const { pool_id } of pools) {
    const dists = db.prepare(`
      SELECT pd.fantasy_points, pd.gross_units, pd.net_units, ut.user_id
      FROM prize_distributions pd
      JOIN user_teams ut ON ut.id = pd.user_team_id
      WHERE pd.match_prize_pool_id = ?
    `).all(pool_id);

    for (const d of dists) {
      upsert.run(
        seasonId, d.user_id,
        d.fantasy_points, d.gross_units, d.net_units,
        d.gross_units > 0 ? 1 : 0
      );
    }
  }

  console.log(`[recomputeLeaderboard] Season ${seasonId}: replayed ${pools.length} matches`);
}

// ── POST /api/admin/matches/:id/void ─────────────────────────────────────────
router.post('/matches/:id/void', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  db.prepare("UPDATE matches SET status = 'abandoned' WHERE id = ?").run(matchId);
  return res.json({ message: 'Match voided' });
});

// ── GET /api/admin/debug/match/:id/players ────────────────────────────────────
// Temp: diagnose player ID mismatches between squad, stats and user teams
router.get('/debug/match/:id/players', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const squadPlayers = db.prepare(`
    SELECT p.id, p.name, p.external_player_id
    FROM players p
    JOIN match_squads ms ON ms.player_id = p.id
    WHERE ms.match_id = ?
    ORDER BY p.name
  `).all(matchId);

  const statsPlayers = db.prepare(`
    SELECT p.id, p.name, p.external_player_id, pms.runs, pms.fantasy_points
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    WHERE pms.match_id = ?
    ORDER BY pms.fantasy_points DESC
  `).all(matchId);

  const teamPlayers = db.prepare(`
    SELECT utp.player_id, p.name, p.external_player_id, ut.user_id
    FROM user_team_players utp
    JOIN user_teams ut ON ut.id = utp.user_team_id
    JOIN players p ON p.id = utp.player_id
    WHERE ut.match_id = ?
  `).all(matchId);

  return res.json({ squadPlayers, statsPlayers, teamPlayers });
});

// ════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const db = getDb();
  const { seasonId, search } = req.query;

  let query = `
    SELECT u.id, u.name, u.email, u.is_admin, u.created_at,
      sm.season_id,
      sl.matches_played, sl.net_units, sl.top_finishes,
      (SELECT COUNT(*) FROM user_teams ut2
       JOIN matches m2 ON m2.id = ut2.match_id
       WHERE ut2.user_id = u.id AND m2.season_id = sm.season_id
         AND ut2.total_fantasy_points = 0 AND m2.status = 'completed') as no_team_count
    FROM users u
    LEFT JOIN season_memberships sm ON sm.user_id = u.id
    LEFT JOIN season_leaderboard sl ON sl.user_id = u.id AND sl.season_id = sm.season_id
  `;
  const params = [];
  const conditions = [];

  if (seasonId) { conditions.push('sm.season_id = ?'); params.push(seasonId); }
  if (search)   { conditions.push('(u.name LIKE ? OR u.email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY u.name';

  const users = db.prepare(query).all(...params);
  return res.json({ users });
});

// ── POST /api/admin/users/:id/reset-password ──────────────────────────────────
router.post('/users/:id/reset-password', (req, res) => {
  const db       = getDb();
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }

  const bcrypt  = require('bcryptjs');
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.params.id);

  return res.json({ message: 'Password reset successfully' });
});

// ── GET /api/admin/dashboard ──────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const { seasonId } = req.query;

  const season = seasonId
    ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId)
    : db.prepare('SELECT * FROM seasons ORDER BY id DESC LIMIT 1').get();

  if (!season) return res.json({ season: null });

  const stats = {
    totalMembers: db.prepare(
      'SELECT COUNT(*) as c FROM season_memberships WHERE season_id = ?'
    ).get(season.id).c,

    totalMatches: db.prepare(
      'SELECT COUNT(*) as c FROM matches WHERE season_id = ?'
    ).get(season.id).c,

    completedMatches: db.prepare(
      "SELECT COUNT(*) as c FROM matches WHERE season_id = ? AND status = 'completed'"
    ).get(season.id).c,

    liveMatches: db.prepare(
      "SELECT COUNT(*) as c FROM matches WHERE season_id = ? AND status = 'live'"
    ).get(season.id).c,

    totalUnitsInPlay: db.prepare(`
      SELECT COALESCE(SUM(mpp.total_units), 0) as total
      FROM match_prize_pools mpp
      JOIN matches m ON m.id = mpp.match_id
      WHERE m.season_id = ?
    `).get(season.id).total,
  };

  const liveMatch = db.prepare(
    "SELECT * FROM matches WHERE season_id = ? AND status = 'live' LIMIT 1"
  ).get(season.id);

  const upcomingMatches = db.prepare(
    "SELECT * FROM matches WHERE season_id = ? AND status = 'upcoming' ORDER BY start_time ASC LIMIT 5"
  ).all(season.id);

  const recentMatches = db.prepare(
    "SELECT * FROM matches WHERE season_id = ? AND status = 'completed' ORDER BY start_time DESC LIMIT 5"
  ).all(season.id);

  return res.json({ season, stats, liveMatch, upcomingMatches, recentMatches });
});

// ════════════════════════════════════════════════════════
// FINALISE LOGIC
// ════════════════════════════════════════════════════════

function finaliseMatch(db, matchId, seasonId) {
  // 1. Ensure auto-swaps are processed
  const { processAutoSwaps } = require('../engines/swapEngine');
  processAutoSwaps(matchId);

  // 2. Final recompute of all team points
  recomputeTeamPoints(matchId);

  // 3. Get entry units for this match
  const matchConfig = db.prepare(
    'SELECT entry_units FROM match_config WHERE match_id = ?'
  ).get(matchId);
  const entryUnits = matchConfig ? matchConfig.entry_units : 300;

  // 4. Rank all teams
  const teams = db.prepare(`
    SELECT id as userId, total_fantasy_points as fantasyPoints
    FROM user_teams WHERE match_id = ?
    ORDER BY total_fantasy_points DESC
  `).all(matchId).map(t => ({ userId: t.userId, fantasyPoints: t.fantasyPoints }));

  // 5. Distribute prizes
  const { totalPool, distributionRule, prizes, carryOver, participantCount } =
    distributePrizes(teams, entryUnits);

  // 6. Write prize pool
  const poolResult = db.prepare(`
    INSERT INTO match_prize_pools
      (match_id, participants_count, total_units, winners_count, distribution_rule, is_finalized, finalized_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(match_id) DO UPDATE SET
      participants_count = excluded.participants_count,
      total_units        = excluded.total_units,
      winners_count      = excluded.winners_count,
      distribution_rule  = excluded.distribution_rule,
      is_finalized       = 1,
      finalized_at       = datetime('now')
  `).run(matchId, participantCount, totalPool,
    prizes.filter(p => p.grossUnits > 0).length,
    distributionRule);

  const poolId = poolResult.lastInsertRowid ||
    db.prepare('SELECT id FROM match_prize_pools WHERE match_id = ?').get(matchId).id;

  // 7. Write prize distributions and update user_teams
  const insertPrize = db.prepare(`
    INSERT INTO prize_distributions
      (match_prize_pool_id, user_team_id, rank, gross_units, net_units, fantasy_points)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateTeam = db.prepare(`
    UPDATE user_teams SET
      match_rank   = ?,
      units_won    = ?,
      finalized_at = datetime('now')
    WHERE id = ?
  `);

  const doFinalise = db.transaction(() => {
    for (const prize of prizes) {
      insertPrize.run(poolId, prize.userId, prize.rank, prize.grossUnits, prize.netUnits, prize.fantasyPoints);
      updateTeam.run(prize.rank, prize.grossUnits, prize.userId);
    }

    // Mark match as completed
    db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").run(matchId);
  });

  doFinalise();

  // 8. Update season leaderboard
  updateSeasonLeaderboard(db, matchId, seasonId, prizes, entryUnits);

  // 9. Send result push notifications
  sendResultNotifications(db, matchId, prizes).catch(console.error);

  // 10. Generate final commentary
  const { generateCommentary } = require('../api/commentaryService');
  generateCommentary(matchId, 'final', '40.0').catch(e =>
    console.error('[commentary] final stage failed:', e.message)
  );
}

function updateSeasonLeaderboard(db, matchId, seasonId, prizes, entryUnits) {
  const updateLeaderboard = db.prepare(`
    INSERT INTO season_leaderboard (season_id, user_id, total_fantasy_points, total_units_won, net_units, matches_played, top_finishes, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      total_fantasy_points = total_fantasy_points + excluded.total_fantasy_points,
      total_units_won      = total_units_won + excluded.total_units_won,
      net_units            = net_units + excluded.net_units,
      matches_played       = matches_played + 1,
      top_finishes         = top_finishes + excluded.top_finishes,
      updated_at           = datetime('now')
  `);

  const updateAll = db.transaction(() => {
    for (const prize of prizes) {
      // Get the user_id from the user_team
      const userTeam = db.prepare('SELECT user_id FROM user_teams WHERE id = ?').get(prize.userId);
      if (!userTeam) continue;

      const isTopFinish = prize.grossUnits > 0 ? 1 : 0;
      updateLeaderboard.run(
        seasonId, userTeam.user_id,
        prize.fantasyPoints,
        prize.grossUnits,
        prize.netUnits,
        isTopFinish
      );
    }
  });

  updateAll();
}

async function sendResultNotifications(db, matchId, prizes) {
  const webpush = require('web-push');
  const match   = db.prepare('SELECT team_a, team_b FROM matches WHERE id = ?').get(matchId);

  for (const prize of prizes) {
    const userTeam = db.prepare('SELECT user_id FROM user_teams WHERE id = ?').get(prize.userId);
    if (!userTeam) continue;

    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userTeam.user_id);
    const payload = JSON.stringify({
      type:     'match_result',
      title:    `Match result: ${match.team_a} vs ${match.team_b}`,
      body:     prize.grossUnits > 0
        ? `You finished rank ${prize.rank} and won ${prize.grossUnits} units!`
        : `You finished rank ${prize.rank}. Better luck next match!`,
      matchId,
      rank:     prize.rank,
      units:    prize.grossUnits,
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateInviteCode() {
  const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code     = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = router;

// ── POST /api/admin/matches/:id/teams ─────────────────────────────────────────
// Admin creates teams for users bypassing match lock (for testing/seeding)
router.post('/matches/:id/teams', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { userId, playerIds, captainId, viceCaptainId, backupIds } = req.body;

  if (!userId || !Array.isArray(playerIds) || playerIds.length !== 11 ||
      !Array.isArray(backupIds) || backupIds.length !== 2 ||
      !captainId || !viceCaptainId) {
    return res.status(400).json({ error: 'userId, 11 playerIds, captainId, viceCaptainId, 2 backupIds required' });
  }

  // Remove existing team if any
  const existing = db.prepare('SELECT id FROM user_teams WHERE user_id=? AND match_id=?').get(userId, matchId);
  if (existing) {
    db.prepare('DELETE FROM user_team_players WHERE user_team_id=?').run(existing.id);
    db.prepare('DELETE FROM user_teams WHERE id=?').run(existing.id);
  }

  const saveTeam = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO user_teams (user_id, match_id, captain_id, vice_captain_id,
        resolved_captain_id, resolved_vice_captain_id, locked_at, swap_processed_at)
      VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).run(userId, matchId, captainId, viceCaptainId, captainId, viceCaptainId);

    const utId = result.lastInsertRowid;
    const ins  = db.prepare('INSERT INTO user_team_players (user_team_id,player_id,is_backup,backup_order) VALUES (?,?,?,?)');

    for (const pid of playerIds)       ins.run(utId, pid, 0, null);
    backupIds.forEach((pid, i) =>       ins.run(utId, pid, 1, i + 1));

    return utId;
  });

  try {
    const utId = saveTeam();
    return res.status(201).json({ message: 'Team created', userTeamId: utId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/reprocess-swaps/:matchId ─────────────────────────────────
// Alias for process-swaps with different path to avoid routing conflicts
router.post('/reprocess-swaps/:matchId', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  db.prepare('UPDATE user_teams SET swap_processed_at = NULL WHERE match_id = ?').run(matchId);
  const { processAutoSwaps, recomputeTeamPoints } = require('../api/syncService');
  const swapped = processAutoSwaps(matchId);
  recomputeTeamPoints(matchId);
  return res.json({ message: `Swaps reprocessed for ${swapped} teams`, matchId });
});

// ════════════════════════════════════════════════════════
// SERIES IMPORT
// ════════════════════════════════════════════════════════

// ── POST /api/admin/series/preview ───────────────────────────────────────────
// Fetch all matches from a CricketData series UUID and return for admin preview
router.post('/series/preview', async (req, res) => {
  const { seriesId } = req.body;
  if (!seriesId) return res.status(400).json({ error: 'seriesId required (CricketData series UUID)' });

  try {
    const cricketdata = require('../api/cricketdata');
    const fixtures    = await cricketdata.fetchSeriesMatches(seriesId);

    const db = getDb();
    const existing = new Set(
      db.prepare('SELECT sportmonks_fixture_id FROM matches WHERE sportmonks_fixture_id IS NOT NULL')
        .all().map(r => r.sportmonks_fixture_id)
    );

    const matches = fixtures.map(f => ({
      externalMatchId: f.externalMatchId,
      name:            f.name || `${(f.teams || [])[0] || ''} vs ${(f.teams || [])[1] || ''}`,
      teamA:           (f.teams || [])[0] || '',
      teamB:           (f.teams || [])[1] || '',
      startTime:       f.dateTimeGMT || f.date,
      matchType:       f.matchType || 't20',
      status:          f.status,
      matchStarted:    f.matchStarted,
      matchEnded:      f.matchEnded,
      hasSquad:        f.hasSquad,
      fantasyEnabled:  f.fantasyEnabled,
      alreadyAdded:    existing.has(f.externalMatchId),
    }));

    return res.json({ seriesId, matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/series/import ────────────────────────────────────────────
// Import selected CricketData matches into a season.
// Expects fixtures array resolved from /series/preview (externalMatchId, teamA, teamB, startTime).
router.post('/series/import', async (req, res) => {
  const { seasonId, fixtures } = req.body;
  if (!seasonId || !Array.isArray(fixtures) || fixtures.length === 0) {
    return res.status(400).json({ error: 'seasonId and fixtures[] required' });
  }

  const db = getDb();
  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const results = [];

  for (const f of fixtures) {
    const existing = db.prepare(
      'SELECT id FROM matches WHERE sportmonks_fixture_id = ? OR external_match_id = ?'
    ).get(f.externalMatchId, f.externalMatchId);

    if (existing) {
      results.push({ externalMatchId: f.externalMatchId, status: 'already_exists', matchId: existing.id });
      continue;
    }

    const matchId = upsertMatch(seasonId, {
      externalMatchId: f.externalMatchId,
      teamA:           f.teamA,
      teamB:           f.teamB,
      venue:           f.venue     || '',
      matchType:       f.matchType || 't20',
      startTime:       f.startTime || f.dateTimeGMT,
    });

    results.push({ externalMatchId: f.externalMatchId, status: 'imported', matchId, name: f.name });
  }

  return res.json({
    message: `Imported ${results.filter(r => r.status === 'imported').length} fixtures`,
    results,
  });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
// Delete a user and all their data
router.delete('/users/:id', (req, res) => {
  const db     = getDb();
  const userId = parseInt(req.params.id, 10);

  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  const deleteUser = db.transaction(() => {
    // Delete in dependency order
    db.prepare(`DELETE FROM user_team_players WHERE user_team_id IN 
      (SELECT id FROM user_teams WHERE user_id = ?)`).run(userId);
    db.prepare('DELETE FROM prize_distributions WHERE user_team_id IN (SELECT id FROM user_teams WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM user_teams WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM season_memberships WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM season_leaderboard WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  deleteUser();
  return res.json({ message: `User ${user.email} deleted` });
});

// ── POST /api/admin/matches/:id/sync-xi ──────────────────────────────────────
// Manually trigger Playing XI sync from CricAPI
router.post('/matches/:id/sync-xi', async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  try {
    const { syncPlayingXi } = require('../api/syncService');
    const result = await syncPlayingXi(matchId, match.external_match_id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/matches/manual ───────────────────────────────────────────
// Manually add a match without CricAPI (for LLC, local leagues etc.)
router.post('/matches/manual', async (req, res) => {
  const db = getDb();
  const { seasonId, teamA, teamB, venue, matchType, startTime, entryUnits, externalMatchId } = req.body;

  if (!seasonId || !teamA || !teamB || !startTime) {
    return res.status(400).json({ error: 'seasonId, teamA, teamB, startTime required' });
  }

  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const matchId = upsertMatch(seasonId, {
    externalMatchId: externalMatchId || `manual-${Date.now()}`,
    teamA, teamB,
    venue: venue || '',
    matchType: matchType || 't20',
    status: 'upcoming',
    startTime,
  });

  if (entryUnits && entryUnits !== 300) {
    db.prepare('UPDATE match_config SET entry_units = ? WHERE match_id = ?').run(entryUnits, matchId);
  }

  let squadCount = 0; // Squad synced by hourly cron via Sportmonks

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  return res.status(201).json({ message: 'Match added', match, squadCount });
});

// fix-match-times removed (no longer needed with Sportmonks)

// old CricAPI sync-all-squads removed — see Sportmonks version below

// ── POST /api/admin/matches/:id/squad/manual ──────────────────────────────────
// Manually add a player to a match squad
// Will be overwritten if CricAPI sync runs later
router.post('/matches/:id/squad/manual', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { name, team, role } = req.body;

  if (!name?.trim() || !team?.trim()) {
    return res.status(400).json({ error: 'name and team are required' });
  }

  const match = db.prepare('SELECT id FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Generate a manual external ID so it doesn't conflict with real CricAPI IDs
  const externalId = `manual-${matchId}-${name.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

  // Upsert player
  db.prepare(`
    INSERT INTO players (name, team, role, external_player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(external_player_id) DO UPDATE SET
      name = excluded.name, team = excluded.team, role = excluded.role
  `).run(name.trim(), team.trim(), normaliseRole(role) || 'batsman', externalId);

  const player = db.prepare('SELECT id FROM players WHERE external_player_id = ?').get(externalId);

  // Add to match squad
  db.prepare(`
    INSERT INTO match_squads (match_id, player_id, is_playing_xi)
    VALUES (?, ?, 0)
    ON CONFLICT(match_id, player_id) DO NOTHING
  `).run(matchId, player.id);

  const squad = db.prepare(`
    SELECT p.*, ms.is_playing_xi FROM match_squads ms
    JOIN players p ON p.id = ms.player_id WHERE ms.match_id = ?
    ORDER BY p.team, p.name
  `).all(matchId);

  return res.json({ message: `Added ${name}`, synced: squad.length, squad });
});

// ── DELETE /api/admin/matches/:id/squad/:playerId ─────────────────────────────
// Remove a player from a match squad
router.delete('/matches/:id/squad/:playerId', (req, res) => {
  const db      = getDb();
  const matchId  = parseInt(req.params.id, 10);
  const playerId = parseInt(req.params.playerId, 10);

  db.prepare('DELETE FROM match_squads WHERE match_id = ? AND player_id = ?').run(matchId, playerId);
  return res.json({ message: 'Player removed from squad' });
});

function normaliseRole(role) {
  if (!role) return null;
  const r = role.toLowerCase();
  if (r.includes('keeper') || r.includes('wk'))  return 'wicketkeeper';
  if (r.includes('all'))                          return 'allrounder';
  if (r.includes('bowl'))                         return 'bowler';
  if (r.includes('bat'))                          return 'batsman';
  return 'batsman';
}

// ── POST /api/admin/sync-all-squads ──────────────────────────────────────────
// Immediately sync squads for all upcoming matches with 0 players (CricketData)
router.post('/sync-all-squads', async (req, res) => {
  const db      = getDb();
  const matches = db.prepare(`
    SELECT m.id, m.sportmonks_fixture_id, m.team_a, m.team_b
    FROM matches m
    WHERE m.status = 'upcoming'
    AND m.sportmonks_fixture_id IS NOT NULL
    AND (SELECT COUNT(*) FROM match_squads ms WHERE ms.match_id = m.id) = 0
  `).all();

  if (matches.length === 0) return res.json({ message: 'All squads already loaded', synced: 0 });

  const cricketdata = require('../api/cricketdata');
  const results     = [];

  for (const match of matches) {
    try {
      const players = await cricketdata.fetchMatchSquad(match.sportmonks_fixture_id);
      if (players.length > 0) {
        upsertSquad(match.id, players);
        results.push({ matchId: match.id, players: players.length, name: `${match.team_a} vs ${match.team_b}` });
      } else {
        results.push({ matchId: match.id, players: 0, name: `${match.team_a} vs ${match.team_b}`, note: 'no squad yet' });
      }
    } catch (err) {
      results.push({ matchId: match.id, error: err.message });
    }
  }

  return res.json({ message: `Synced ${results.length} matches`, results });
});

// ── POST /api/admin/reset-data ────────────────────────────────────────────────
// Nuclear option: delete all match/season/player data, keep users + feedback
router.post('/reset-data', (req, res) => {
  const db = getDb();
  const { confirm } = req.body;
  if (confirm !== 'RESET') return res.status(400).json({ error: 'Send confirm: RESET' });

  // Disable foreign keys temporarily for clean wipe
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      DELETE FROM rank_snapshots;
      DELETE FROM player_match_stats;
      DELETE FROM match_squads;
      DELETE FROM user_team_players;
      DELETE FROM user_teams;
      DELETE FROM prize_distributions;
      DELETE FROM match_prize_pools;
      DELETE FROM match_config;
      DELETE FROM matches;
      DELETE FROM players;
      DELETE FROM season_memberships;
      DELETE FROM seasons;
      DELETE FROM push_subscriptions;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }

  console.log('[admin] Full data reset performed');
  return res.json({ message: 'All season/match/player data deleted. Users and feedback preserved.' });
});

// ── POST /api/admin/seasons/:id/add-all-users ─────────────────────────────────
// Add all registered users to a season
router.post('/seasons/:id/add-all-users', (req, res) => {
  const db = getDb();
  const seasonId = parseInt(req.params.id, 10);
  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const users = db.prepare('SELECT id FROM users').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO season_memberships (season_id, user_id) VALUES (?, ?)'
  );
  const addAll = db.transaction(() => {
    for (const u of users) insert.run(seasonId, u.id);
  });
  addAll();
  return res.json({ message: `Added ${users.length} users to season ${seasonId}` });
});

// ── POST /api/admin/fix-player-in-team ───────────────────────────────────────
// Replaces a wrong player_id with the correct one in user_team_players for a match
router.post('/fix-player-in-team', (req, res) => {
  const db = getDb();
  const { match_id, wrong_player_id, correct_player_id } = req.body;
  if (!match_id || !wrong_player_id || !correct_player_id)
    return res.status(400).json({ error: 'match_id, wrong_player_id, correct_player_id required' });

  // Find all user_teams for this match that have the wrong player
  const teams = db.prepare(`
    SELECT ut.id as user_team_id, u.name as team_name
    FROM user_team_players utp
    JOIN user_teams ut ON ut.id = utp.user_team_id
    JOIN users u ON u.id = ut.user_id
    WHERE ut.match_id = ? AND utp.player_id = ?
  `).all(match_id, wrong_player_id);

  if (teams.length === 0)
    return res.json({ message: 'No teams found with wrong player', fixed: [] });

  const fix = db.prepare(
    'UPDATE user_team_players SET player_id = ? WHERE user_team_id = ? AND player_id = ?'
  );
  const fixed = [];
  db.transaction(() => {
    for (const t of teams) {
      fix.run(correct_player_id, t.user_team_id, wrong_player_id);
      fixed.push(t.team_name);
    }
  })();

  return res.json({ message: `Fixed ${fixed.length} teams`, fixed });
});


// ── POST /api/admin/matches/:id/reset-finalise ────────────────────────────────
// Clears prize distributions and resets match status so it can be re-finalised
router.post('/matches/:id/reset-finalise', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);

  db.transaction(() => {
    // Clear prize distributions
    db.prepare(`
      DELETE FROM prize_distributions
      WHERE user_team_id IN (SELECT id FROM user_teams WHERE match_id = ?)
    `).run(matchId);

    // Clear match prize pool
    db.prepare('DELETE FROM match_prize_pools WHERE match_id = ?').run(matchId);

    // Reset units_won on user_teams
    db.prepare('UPDATE user_teams SET units_won = 0 WHERE match_id = ?').run(matchId);

    // Reset match status to completed (not finalised)
    db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").run(matchId);
  })();

  return res.json({ message: `Match ${matchId} reset — ready to re-finalise` });
});



// ── POST /api/admin/matches/:id/set-units ─────────────────────────────────────
router.post('/matches/:id/set-units', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { allocations } = req.body;
  db.transaction(() => {
    for (const a of allocations) {
      db.prepare('UPDATE user_teams SET units_won = ?, match_rank = ? WHERE match_id = ? AND user_id = ?')
        .run(a.units_won, a.rank, matchId, a.user_id);
    }
  })();
  return res.json({ message: 'Units set', count: allocations.length });
});


// ── POST /api/admin/matches/:id/fix-prize-distributions ──────────────────────
router.post('/matches/:id/fix-prize-distributions', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { distributions } = req.body; // [{user_team_id, rank, gross_units, net_units, fantasy_points}]
  const pool = db.prepare('SELECT id FROM match_prize_pools WHERE match_id = ?').get(matchId);
  if (!pool) return res.status(404).json({ error: 'No prize pool for this match' });
  db.transaction(() => {
    db.prepare('DELETE FROM prize_distributions WHERE match_prize_pool_id = ?').run(pool.id);
    const ins = db.prepare('INSERT INTO prize_distributions (match_prize_pool_id, user_team_id, rank, gross_units, net_units, fantasy_points) VALUES (?, ?, ?, ?, ?, ?)');
    for (const d of distributions) {
      ins.run(pool.id, d.user_team_id, d.rank, d.gross_units, d.net_units, d.fantasy_points);
    }
  })();
  return res.json({ message: 'Prize distributions fixed', count: distributions.length });
});


// ── POST /api/admin/matches/:id/fix-external-ids ─────────────────────────────
router.post('/matches/:id/fix-external-ids', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { mappings } = req.body; // [{player_id, external_player_id}]
  db.transaction(() => {
    for (const m of mappings) {
      db.prepare('UPDATE match_squads SET external_player_id = ? WHERE match_id = ? AND player_id = ?')
        .run(String(m.external_player_id), matchId, m.player_id);
      db.prepare('UPDATE players SET external_player_id = ?, sportmonks_player_id = ? WHERE id = ?')
        .run(String(m.external_player_id), parseInt(m.external_player_id, 10) || null, m.player_id);
    }
  })();
  return res.json({ message: 'External IDs fixed', count: mappings.length });
});


// ── POST /api/admin/matches/:id/fix-squad-teams ──────────────────────────────
router.post('/matches/:id/fix-squad-teams', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { assignments } = req.body; // [{external_player_id, team}]
  db.transaction(() => {
    for (const a of assignments) {
      db.prepare('UPDATE players SET team = ? WHERE external_player_id = ?')
        .run(a.team, String(a.external_player_id));
    }
  })();
  return res.json({ message: 'Teams fixed', count: assignments.length });
});

// ── POST /api/admin/seasons/:id/rebuild-standings ─────────────────────────────
router.post('/seasons/:id/rebuild-standings', (req, res) => {
  const db = getDb();
  const seasonId = parseInt(req.params.id, 10);

  db.transaction(() => {
    // Clear existing standings
    db.prepare('DELETE FROM season_leaderboard WHERE season_id = ?').run(seasonId);

    // Recompute from all finalised matches
    const rows = db.prepare(`
      SELECT
        ut.user_id,
        SUM(ut.total_fantasy_points) as total_pts,
        SUM(ut.units_won)            as total_units_won,
        SUM(ut.units_won - COALESCE(mc.entry_units, 300)) as net_units,
        COUNT(*)                     as matches_played,
        SUM(CASE WHEN ut.match_rank <= 3 THEN 1 ELSE 0 END) as top_finishes
      FROM user_teams ut
      JOIN matches m ON m.id = ut.match_id
      LEFT JOIN match_config mc ON mc.match_id = m.id
      WHERE m.season_id = ? AND m.status = 'completed'
      GROUP BY ut.user_id
    `).all(seasonId);

    const insert = db.prepare(`
      INSERT INTO season_leaderboard
        (season_id, user_id, total_fantasy_points, total_units_won, net_units, matches_played, top_finishes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const r of rows) {
      insert.run(seasonId, r.user_id, r.total_pts, r.total_units_won, r.net_units, r.matches_played, r.top_finishes);
    }
  })();

  return res.json({ message: `Standings rebuilt for season ${seasonId}` });
});


// ── POST /api/admin/matches/:matchId/set-playing-xi ──────────────────────────
router.post('/matches/:matchId/set-playing-xi', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const { player_id, is_playing_xi, external_player_id } = req.body;

  if (player_id === undefined) return res.status(400).json({ error: 'player_id required' });

  try {
    // Update is_playing_xi in match_squads
    const result = db.prepare(
      'UPDATE match_squads SET is_playing_xi = ? WHERE match_id = ? AND player_id = ?'
    ).run(is_playing_xi ? 1 : 0, matchId, player_id);

    // Update external_player_id and sportmonks_player_id in players table if provided
    if (external_player_id) {
      const extId = String(external_player_id);
      // Check if another player already has this external_player_id
      const existing = db.prepare('SELECT id FROM players WHERE external_player_id = ? AND id != ?')
        .get(extId, player_id);
      if (!existing) {
        db.prepare('UPDATE players SET external_player_id = ?, sportmonks_player_id = ? WHERE id = ?')
          .run(extId, parseInt(extId, 10) || null, player_id);
      }
    }

    return res.json({ message: 'Updated', changes: result.changes });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});


// ── POST /api/admin/matches/:matchId/fix-captain-vc ──────────────────────────
router.post('/matches/:matchId/fix-captain-vc', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const { wrong_player_id, correct_player_id } = req.body;

  const results = {};
  db.transaction(() => {
    results.captain = db.prepare(
      'UPDATE user_teams SET captain_id = ? WHERE match_id = ? AND captain_id = ?'
    ).run(correct_player_id, matchId, wrong_player_id).changes;
    results.vice_captain = db.prepare(
      'UPDATE user_teams SET vice_captain_id = ? WHERE match_id = ? AND vice_captain_id = ?'
    ).run(correct_player_id, matchId, wrong_player_id).changes;
    results.resolved_captain = db.prepare(
      'UPDATE user_teams SET resolved_captain_id = ? WHERE match_id = ? AND resolved_captain_id = ?'
    ).run(correct_player_id, matchId, wrong_player_id).changes;
    results.resolved_vc = db.prepare(
      'UPDATE user_teams SET resolved_vice_captain_id = ? WHERE match_id = ? AND resolved_vice_captain_id = ?'
    ).run(correct_player_id, matchId, wrong_player_id).changes;
  })();

  return res.json({ message: 'Captain/VC references fixed', changes: results });
});


// ── POST /api/admin/matches/:matchId/force-swap ───────────────────────────────
router.post('/matches/:matchId/force-swap', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const { user_id, out_player_id, in_player_id } = req.body;

  const ut = db.prepare('SELECT id FROM user_teams WHERE match_id = ? AND user_id = ?').get(matchId, user_id);
  if (!ut) return res.status(404).json({ error: 'Team not found' });

  db.transaction(() => {
    // Swap out
    db.prepare('UPDATE user_team_players SET is_backup = 1 WHERE user_team_id = ? AND player_id = ?')
      .run(ut.id, out_player_id);
    // Swap in
    db.prepare('UPDATE user_team_players SET is_backup = 0 WHERE user_team_id = ? AND player_id = ?')
      .run(ut.id, in_player_id);
  })();

  const { recomputeTeamPoints } = require('../api/syncService');
  recomputeTeamPoints(matchId);

  return res.json({ message: 'Swap done', out: out_player_id, in: in_player_id });
});


// ── POST /api/admin/matches/:matchId/set-captain ──────────────────────────────
router.post('/matches/:matchId/set-captain', (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const { user_id, captain_id, vice_captain_id } = req.body;

  const ut = db.prepare('SELECT id FROM user_teams WHERE match_id = ? AND user_id = ?').get(matchId, user_id);
  if (!ut) return res.status(404).json({ error: 'Team not found' });

  db.transaction(() => {
    if (captain_id) {
      db.prepare('UPDATE user_teams SET captain_id = ?, resolved_captain_id = ? WHERE id = ?')
        .run(captain_id, captain_id, ut.id);
      db.prepare("UPDATE user_team_players SET inherited_role = 'normal' WHERE user_team_id = ? AND inherited_role = 'captain'")
        .run(ut.id);
      db.prepare("UPDATE user_team_players SET inherited_role = 'captain' WHERE user_team_id = ? AND player_id = ?")
        .run(ut.id, captain_id);
    }
    if (vice_captain_id) {
      db.prepare('UPDATE user_teams SET vice_captain_id = ?, resolved_vice_captain_id = ? WHERE id = ?')
        .run(vice_captain_id, vice_captain_id, ut.id);
      db.prepare("UPDATE user_team_players SET inherited_role = 'normal' WHERE user_team_id = ? AND inherited_role = 'vice_captain'")
        .run(ut.id);
      db.prepare("UPDATE user_team_players SET inherited_role = 'vice_captain' WHERE user_team_id = ? AND player_id = ?")
        .run(ut.id, vice_captain_id);
    }
  })();

  return res.json({ message: 'Captain/VC set', user_id, captain_id, vice_captain_id });
});

