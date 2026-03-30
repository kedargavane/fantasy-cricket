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

// ── GET /api/push/status ─────────────────────────────────────────────────────
// Show who has push notifications enabled
router.get('/status', requireAuth, (req, res) => {
  const db = getDb();
  const subs = db.prepare(`
    SELECT u.name, u.email, COUNT(ps.id) as sub_count, MAX(ps.created_at) as last_registered
    FROM users u
    LEFT JOIN push_subscriptions ps ON ps.user_id = u.id
    GROUP BY u.id
    ORDER BY sub_count DESC, u.name ASC
  `).all();
  const vapidConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  return res.json({ vapidConfigured, users: subs });
});

// ── POST /api/push/test ───────────────────────────────────────────────────────
// Send a test push notification to all subscribers
router.post('/test', requireAuth, async (req, res) => {
  const db = getDb();
  const webpush = require('web-push');
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  let sent = 0, failed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
        JSON.stringify({ title: '🏏 Test notification', body: 'Push notifications are working!' })
      );
      sent++;
    } catch(e) {
      failed++;
      if (e.statusCode === 410 || e.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
  return res.json({ sent, failed, total: subs.length, vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY) });
});

module.exports = router;
