'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { getDb }       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { name, email, password, inviteCode } = req.body;

  if (!name || !email || !password || !inviteCode) {
    return res.status(400).json({ error: 'name, email, password and inviteCode are required' });
  }

  const db = getDb();

  // Validate invite code → find season
  const season = db.prepare(
    'SELECT id, max_players FROM seasons WHERE invite_code = ?'
  ).get(inviteCode);

  if (!season) {
    return res.status(400).json({ error: 'Invalid invite code' });
  }

  // Check season capacity
  const memberCount = db.prepare(
    'SELECT COUNT(*) as count FROM season_memberships WHERE season_id = ?'
  ).get(season.id).count;

  if (memberCount >= season.max_players) {
    return res.status(400).json({ error: 'This league is full' });
  }

  // Check email not already taken
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const register = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
    ).run(name, email.toLowerCase().trim(), passwordHash);

    const userId = result.lastInsertRowid;

    db.prepare(
      'INSERT INTO season_memberships (season_id, user_id) VALUES (?, ?)'
    ).run(season.id, userId);

    // Initialise season leaderboard entry
    db.prepare(
      'INSERT INTO season_leaderboard (season_id, user_id) VALUES (?, ?)'
    ).run(season.id, userId);

    return userId;
  });

  try {
    const userId = register();
    const user   = db.prepare('SELECT id, name, email, is_admin FROM users WHERE id = ?').get(userId);
    const token  = signToken(user);
    return res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('[auth/register]', err.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  return res.json({ token, user: safeUser(user) });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?')
                 .get(req.user.id);

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Get all seasons this user belongs to
  const seasons = db.prepare(`
    SELECT s.id, s.name, s.year, s.status, s.invite_code
    FROM seasons s
    JOIN season_memberships sm ON sm.season_id = s.id
    WHERE sm.user_id = ?
  `).all(user.id);

  return res.json({ user: safeUser(user), seasons });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

  return res.json({ message: 'Password updated successfully' });
});

// ── POST /api/auth/update-profile ────────────────────────────────────────────
router.post('/update-profile', requireAuth, (req, res) => {
  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  const db = getDb();
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user.id);

  const user = db.prepare('SELECT id, name, email, is_admin FROM users WHERE id = ?').get(req.user.id);
  return res.json({ user: safeUser(user) });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.is_admin === 1 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, isAdmin: user.is_admin === 1 };
}

module.exports = router;
