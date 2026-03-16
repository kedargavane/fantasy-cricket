'use strict';
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// ── GET /api/feedback ─────────────────────────────────────────────────────────
// Get all feedback items (visible to all logged-in users)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT f.*, u.name as user_name
    FROM feedback f
    JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC
  `).all();
  return res.json({ feedback: items });
});

// ── POST /api/feedback ────────────────────────────────────────────────────────
// Submit new feedback
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { type, title, details } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const validTypes = ['bug', 'feature', 'ux', 'general'];
  const feedbackType = validTypes.includes(type) ? type : 'general';

  const result = db.prepare(`
    INSERT INTO feedback (user_id, type, title, details)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, feedbackType, title.trim(), details?.trim() || '');

  const item = db.prepare(
    'SELECT f.*, u.name as user_name FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?'
  ).get(result.lastInsertRowid);

  return res.status(201).json({ feedback: item });
});

// ── PATCH /api/feedback/:id ───────────────────────────────────────────────────
// Admin: update status and resolution
router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { status, resolution } = req.body;
  const id = parseInt(req.params.id, 10);

  const item = db.prepare('SELECT id FROM feedback WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const validStatuses = ['open', 'in_progress', 'resolved'];
  db.prepare(`
    UPDATE feedback SET
      status = COALESCE(?, status),
      resolution = COALESCE(?, resolution),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    validStatuses.includes(status) ? status : null,
    resolution !== undefined ? resolution : null,
    id
  );

  const updated = db.prepare(
    'SELECT f.*, u.name as user_name FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?'
  ).get(id);
  return res.json({ feedback: updated });
});

// ── DELETE /api/feedback/:id ──────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM feedback WHERE id = ?').run(parseInt(req.params.id, 10));
  return res.json({ message: 'Deleted' });
});

module.exports = router;
