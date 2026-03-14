'use strict';

const express = require('express');
const { getDb }       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/push/vapid-public-key ────────────────────────────────────────────
router.get('/vapid-public-key', (req, res) => {
  return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// ── POST /api/push/subscribe ──────────────────────────────────────────────────
router.post('/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys, userAgent } = req.body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint, keys.p256dh and keys.auth required' });
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id    = excluded.user_id,
      p256dh_key = excluded.p256dh_key,
      auth_key   = excluded.auth_key,
      last_used_at = datetime('now')
  `).run(req.user.id, endpoint, keys.p256dh, keys.auth, userAgent || '');

  return res.status(201).json({ message: 'Subscribed to push notifications' });
});

// ── DELETE /api/push/unsubscribe ──────────────────────────────────────────────
router.delete('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  const db = getDb();
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(req.user.id, endpoint);

  return res.json({ message: 'Unsubscribed' });
});

module.exports = router;
