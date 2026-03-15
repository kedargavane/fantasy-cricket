'use strict';

const express = require('express');
const { getDb }                  = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upsertMatch, upsertSquad, processAutoSwaps, recomputeTeamPoints } = require('../api/syncService');
const { distributePrizes }       = require('../engines/prizeEngine');
const { sendMatchReminders }     = require('../jobs/cronJobs');
const { discoverMatches }        = require('../api/discoverMatches');

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
  const { status, maxPlayers } = req.body;

  if (status && !['upcoming','active','completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const fields = [];
  const values = [];
  if (status)     { fields.push('status = ?');      values.push(status); }
  if (seriesIds !== undefined) { fields.push('series_ids = ?'); values.push(JSON.stringify(seriesIds)); }

  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.params.id);
  db.prepare(`UPDATE seasons SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  return res.json({ season });
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

  try {
    const { runAutoSchedule } = require('../api/autoSchedule');
    const result = await runAutoSchedule();
    return res.json({ message: 'Schedule sync complete', ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/discover ──────────────────────────────────────────────────
// Browse upcoming matches from CricAPI and approve them into the season
router.get('/discover', async (req, res) => {
  const db = getDb();
  return discoverMatches(req, res, db);
});

// ── POST /api/admin/discover/approve ─────────────────────────────────────────
// Approve a match from CricAPI discovery into the season
router.post('/discover/approve', async (req, res) => {
  const db = getDb();
  const { seasonId, externalMatchId, teamA, teamB, venue, matchType, startTime, entryUnits } = req.body;

  if (!seasonId || !externalMatchId || !teamA || !teamB || !startTime) {
    return res.status(400).json({ error: 'seasonId, externalMatchId, teamA, teamB, startTime required' });
  }

  // Check not already added
  const existing = db.prepare('SELECT id FROM matches WHERE external_match_id = ?').get(externalMatchId);
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

  // Auto-sync squad immediately
  try {
    const cricapi = require('../api/cricapi');
    const players = await cricapi.fetchMatchSquad(externalMatchId);
    if (players.length > 0) {
      const { upsertSquad } = require('../api/syncService');
      upsertSquad(matchId, players);
    }
  } catch { /* squad not available yet — that's fine */ }

  const match = db.prepare('SELECT m.*, mc.entry_units FROM matches m LEFT JOIN match_config mc ON mc.match_id = m.id WHERE m.id = ?').get(matchId);
  return res.status(201).json({ message: 'Match approved and added to season', match });
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
router.post('/matches', (req, res) => {
  const { seasonId, externalMatchId, teamA, teamB, venue, matchType, startTime, entryUnits } = req.body;

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
  const { status, startTime, entryUnits } = req.body;

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (status) {
    db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, matchId);
  }
  if (startTime) {
    db.prepare('UPDATE matches SET start_time = ? WHERE id = ?').run(startTime, matchId);
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

// ── POST /api/admin/matches/:id/sync-squad ────────────────────────────────────
// Pull squad from CricAPI automatically
router.post('/matches/:id/sync-squad', async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT external_match_id FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  try {
    const cricapi = require('../api/cricapi');
    const players = await cricapi.fetchMatchSquad(match.external_match_id);
    upsertSquad(matchId, players);

    const squad = db.prepare(`
      SELECT p.*, ms.is_playing_xi FROM match_squads ms
      JOIN players p ON p.id = ms.player_id WHERE ms.match_id = ?
    `).all(matchId);

    return res.json({ squad, synced: players.length });
  } catch (err) {
    return res.status(500).json({ error: `CricAPI sync failed: ${err.message}` });
  }
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

// ── POST /api/admin/matches/:id/void ─────────────────────────────────────────
router.post('/matches/:id/void', (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  db.prepare("UPDATE matches SET status = 'abandoned' WHERE id = ?").run(matchId);
  return res.json({ message: 'Match voided' });
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
    : db.prepare("SELECT * FROM seasons WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();

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
