'use strict';

const express        = require('express');
const { getDb }      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const cricketdata    = require('../api/cricketdata');
const { cdGet }      = cricketdata;

const router = express.Router();

// Build innings array from CricketData match_info response
// (match_info returns scorecard, score, tossWinner and matchWinner in one
// call when fantasyEnabled is true — same endpoint cricketdata.js uses)
async function buildScorecard(externalMatchId) {
  const data = await cdGet('match_info', { id: externalMatchId });
  const d    = data.data || {};

  const teamA = d.teams?.[0] || '';
  const teamB = d.teams?.[1] || '';

  return cricketdata.buildDisplayInnings(d.scorecard, teamA, teamB, d.score);
}

// GET /api/scorecard/:matchId — serve from cache, refresh if live
router.get('/:matchId', requireAuth, async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  // Serve cached scorecard for completed matches
  if (match.status === 'completed' && match.scorecard_json) {
    return res.json({ innings: JSON.parse(match.scorecard_json), cached: true });
  }

  const externalId = match.sportmonks_fixture_id;
  if (!externalId) {
    return res.status(400).json({ error: 'No match ID available' });
  }

  try {
    const innings = await buildScorecard(externalId);
    if (match.status === 'completed') {
      db.prepare('UPDATE matches SET scorecard_json = ? WHERE id = ?')
        .run(JSON.stringify(innings), matchId);
    }
    return res.json({ innings, cached: false });
  } catch (err) {
    if (match.scorecard_json) {
      return res.json({ innings: JSON.parse(match.scorecard_json), cached: true, stale: true });
    }
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/scorecard/:matchId/refresh — force refresh from CricketData
router.post('/:matchId/refresh', requireAuth, async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const match   = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  try {
    const innings = await buildScorecard(match.sportmonks_fixture_id);
    db.prepare('UPDATE matches SET scorecard_json = ? WHERE id = ?')
      .run(JSON.stringify(innings), matchId);
    return res.json({ innings, ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { router, buildScorecard };
