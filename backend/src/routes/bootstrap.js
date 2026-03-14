'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb } = require('../db/database');

const router = express.Router();

/**
 * POST /api/bootstrap
 * One-time seed endpoint. Creates admin user + season + test data.
 * Disables itself permanently after first successful call.
 * Protected by a secret key passed as ?key=... query param.
 */
router.post('/', (req, res) => {
  const db = getDb();

  // Check if already bootstrapped
  const alreadyDone = db.prepare(
    "SELECT id FROM users WHERE email = 'admin@test.com'"
  ).get();

  if (alreadyDone) {
    return res.status(400).json({ error: 'Already bootstrapped. Use existing credentials.' });
  }

  // Optional secret key protection (set BOOTSTRAP_KEY env var)
  const secretKey = process.env.BOOTSTRAP_KEY;
  if (secretKey && req.query.key !== secretKey) {
    return res.status(403).json({ error: 'Invalid bootstrap key' });
  }

  try {
    const bootstrap = db.transaction(() => {
      // 1. Create admin user
      const hash = bcrypt.hashSync('password123', 10);
      const adminResult = db.prepare(
        'INSERT INTO users (name, email, password_hash, is_admin) VALUES (?,?,?,1)'
      ).run('Admin', 'admin@test.com', hash);
      const adminId = adminResult.lastInsertRowid;

      // 2. Create test users
      const testUsers = [
        { name: 'Rahul',   email: 'rahul@test.com' },
        { name: 'Priya',   email: 'priya@test.com' },
        { name: 'Karthik', email: 'karthik@test.com' },
        { name: 'Sneha',   email: 'sneha@test.com' },
      ];
      const userIds = { 'admin@test.com': adminId };
      for (const u of testUsers) {
        const r = db.prepare(
          'INSERT INTO users (name, email, password_hash, is_admin) VALUES (?,?,?,0)'
        ).run(u.name, u.email, bcrypt.hashSync('password123', 10));
        userIds[u.email] = r.lastInsertRowid;
      }

      // 3. Create season
      const seasonResult = db.prepare(`
        INSERT INTO seasons (name, year, status, invite_code, admin_user_id, max_players, series_ids)
        VALUES (?,?,?,?,?,?,?)
      `).run('LLC 2026 Test League', 2026, 'active', 'LLC2026', adminId, 20, '[]');
      const seasonId = seasonResult.lastInsertRowid;

      // 4. Add all users to season
      for (const uid of Object.values(userIds)) {
        db.prepare(
          'INSERT INTO season_memberships (season_id, user_id) VALUES (?,?)'
        ).run(seasonId, uid);
        db.prepare(
          'INSERT OR IGNORE INTO season_leaderboard (season_id, user_id) VALUES (?,?)'
        ).run(seasonId, uid);
      }

      // 5. Create today's match (Mumbai Spartans vs India Tigers)
      const matchResult = db.prepare(`
        INSERT INTO matches (season_id, external_match_id, team_a, team_b, venue, match_type, status, start_time)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        seasonId,
        '106f2025-7660-4a5f-aa6e-8ab8a3a62124',
        'Mumbai Spartans',
        'India Tigers',
        'Indira Gandhi International Cricket Stadium, Haldwani',
        't20',
        'upcoming',
        '2026-03-14T14:00:00.000Z'
      );
      const matchId = matchResult.lastInsertRowid;
      db.prepare('INSERT INTO match_config (match_id, entry_units) VALUES (?,?)').run(matchId, 300);

      return { adminId, seasonId, matchId, inviteCode: 'LLC2026' };
    });

    const result = bootstrap();

    return res.json({
      message: 'Bootstrap successful!',
      season: 'LLC 2026 Test League',
      inviteCode: result.inviteCode,
      matchId: result.matchId,
      credentials: {
        admin:   { email: 'admin@test.com',   password: 'password123' },
        users:   ['rahul@test.com', 'priya@test.com', 'karthik@test.com', 'sneha@test.com'],
        password: 'password123 (all users)'
      },
      next: 'Login at /login with admin@test.com / password123'
    });

  } catch (err) {
    console.error('[bootstrap]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
