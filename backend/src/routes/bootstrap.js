'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb } = require('../db/database');

const router = express.Router();

/**
 * POST /api/bootstrap
 * One-time setup — creates admin + season + BAN vs PAK match.
 * Safe to call multiple times — skips if already done.
 */
router.post('/', async (req, res) => {
  const db = getDb();

  const alreadyDone = db.prepare(
    "SELECT id FROM users WHERE email = 'admin@test.com'"
  ).get();

  if (alreadyDone) {
    return res.status(400).json({
      error: 'Already bootstrapped.',
      hint: 'Use POST /api/bootstrap/reset to clear all data first.',
      credentials: { email: 'admin@test.com', password: 'password123' }
    });
  }

  const secretKey = process.env.BOOTSTRAP_KEY;
  if (secretKey && req.query.key !== secretKey) {
    return res.status(403).json({ error: 'Invalid bootstrap key' });
  }

  try {
    const result = db.transaction(() => {
      // Admin user
      const hash    = bcrypt.hashSync('password123', 10);
      const adminId = db.prepare('INSERT INTO users (name,email,password_hash,is_admin) VALUES (?,?,?,1)')
        .run('Admin', 'admin@test.com', hash).lastInsertRowid;

      // Test users
      const testUsers = [
        { name: 'Rahul',   email: 'rahul@test.com' },
        { name: 'Priya',   email: 'priya@test.com' },
        { name: 'Karthik', email: 'karthik@test.com' },
        { name: 'Sneha',   email: 'sneha@test.com' },
      ];
      const userIds = { 'admin@test.com': adminId };
      for (const u of testUsers) {
        const r = db.prepare('INSERT INTO users (name,email,password_hash,is_admin) VALUES (?,?,?,0)')
          .run(u.name, u.email, bcrypt.hashSync('password123', 10));
        userIds[u.email] = r.lastInsertRowid;
      }

      // Season
      const seasonId = db.prepare(`
        INSERT INTO seasons (name,year,status,invite_code,admin_user_id,max_players,series_ids)
        VALUES (?,?,?,?,?,?,?)
      `).run('Gyarah Sapne — Season 1', 2026, 'active', 'GYARAH1', adminId, 20, '[]').lastInsertRowid;

      // Add all users to season
      for (const uid of Object.values(userIds)) {
        db.prepare('INSERT INTO season_memberships (season_id,user_id) VALUES (?,?)').run(seasonId, uid);
        db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id,user_id) VALUES (?,?)').run(seasonId, uid);
      }

      // BAN vs PAK 3rd ODI — March 15 1:45 PM IST = 08:15 UTC
      const matchId = db.prepare(`
        INSERT INTO matches (season_id,external_match_id,team_a,team_b,venue,match_type,status,start_time)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        seasonId,
        'c26cb45e-361e-4613-8d7b-226e8255d67c',
        'Bangladesh', 'Pakistan',
        'Shere Bangla National Stadium, Mirpur, Dhaka',
        'odi', 'upcoming',
        '2026-03-15T08:15:00.000Z'
      ).lastInsertRowid;

      db.prepare('INSERT INTO match_config (match_id,entry_units) VALUES (?,?)').run(matchId, 300);

      return { adminId, seasonId, matchId, inviteCode: 'GYARAH1' };
    })();

    // Auto-sync squad from CricAPI after creating match
    try {
      const { fetchMatchSquad } = require('../api/cricapi');
      const { upsertSquad }     = require('../api/syncService');
      const players = await fetchMatchSquad('c26cb45e-361e-4613-8d7b-226e8255d67c');
      if (players.length > 0) upsertSquad(result.matchId, players);
      console.log(`[bootstrap] Synced ${players.length} players`);
    } catch (e) {
      console.warn('[bootstrap] Squad sync failed (will need manual sync):', e.message);
    }

    return res.json({
      message: 'Bootstrap successful! Welcome to Gyarah Sapne 🏏',
      season:     'Gyarah Sapne — Season 1',
      inviteCode: result.inviteCode,
      match:      'Bangladesh vs Pakistan 3rd ODI — Mar 15, 1:45 PM IST',
      matchId:    result.matchId,
      credentials: {
        admin: { email: 'admin@test.com', password: 'password123' },
        users: ['rahul@test.com', 'priya@test.com', 'karthik@test.com', 'sneha@test.com'],
        password: 'password123 (all users)'
      }
    });
  } catch (err) {
    console.error('[bootstrap]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bootstrap/reset
 * Wipes ALL data and re-runs bootstrap.
 * Protected by BOOTSTRAP_KEY env var if set.
 */
router.post('/reset', (req, res) => {
  const secretKey = process.env.BOOTSTRAP_KEY;
  if (secretKey && req.query.key !== secretKey) {
    return res.status(403).json({ error: 'Invalid bootstrap key' });
  }

  const db = getDb();

  try {
    // Clear all tables in dependency order
    const tables = [
      'prize_distributions', 'match_prize_pools',
      'user_team_swaps', 'user_team_players', 'user_teams',
      'player_match_stats', 'match_squads', 'match_config', 'matches',
      'season_leaderboard', 'season_memberships', 'seasons',
      'push_subscriptions', 'players', 'users',
    ];

    db.transaction(() => {
      for (const t of tables) {
        db.prepare(`DELETE FROM ${t}`).run();
        // Reset autoincrement
        try { db.prepare(`DELETE FROM sqlite_sequence WHERE name='${t}'`).run(); } catch {}
      }
    })();

    console.log('[bootstrap/reset] All data cleared');
    return res.json({ message: 'All data cleared. Now call POST /api/bootstrap to set up fresh.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bootstrap/sync-season ──────────────────────────────────────────
// Add ALL users in DB to season — safe to run multiple times
router.post('/sync-season', (req, res) => {
  const db = getDb();
  const season = db.prepare("SELECT id FROM seasons WHERE status='active' LIMIT 1").get();
  if (!season) return res.status(404).json({ error: 'No active season' });

  const users = db.prepare('SELECT id FROM users').all();
  let added = 0;

  db.transaction(() => {
    for (const u of users) {
      const exists = db.prepare(
        'SELECT id FROM season_memberships WHERE season_id=? AND user_id=?'
      ).get(season.id, u.id);
      if (!exists) {
        db.prepare('INSERT INTO season_memberships (season_id,user_id) VALUES (?,?)').run(season.id, u.id);
        db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id,user_id) VALUES (?,?)').run(season.id, u.id);
        added++;
      } else {
        db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id,user_id) VALUES (?,?)').run(season.id, u.id);
      }
    }
  })();

  return res.json({ message: `Synced ${users.length} users, added ${added} new members`, seasonId: season.id });
});

module.exports = router;
