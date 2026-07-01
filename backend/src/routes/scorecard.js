'use strict';

const express        = require('express');
const { getDb }      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { cdGet }      = require('../api/cricketdata');

const router = express.Router();

// Build innings array from CricketData match_scorecard response
async function buildScorecard(externalMatchId) {
  const data = await cdGet('match_scorecard', { id: externalMatchId });
  const d    = data.data || {};

  const teamA = d.teams?.[0] || '';
  const teamB = d.teams?.[1] || '';

  const innings = (d.scorecard || []).map((inn, idx) => {
    const innName     = inn.inning || '';
    // Determine batting team from inning label string
    const battingTeam = innName.toLowerCase().includes(teamA.toLowerCase()) ? teamA : teamB;
    const bowlingTeam = battingTeam === teamA ? teamB : teamA;

    const batting = (inn.batting || []).map((b, si) => ({
      name:      b.batsman?.name || '',
      runs:      b.r    ?? 0,
      balls:     b.b    ?? 0,
      fours:     b['4s'] ?? 0,
      sixes:     b['6s'] ?? 0,
      sr:        b.sr   || '0.00',
      dismissal: b['dismissal-text'] || 'not out',
      sort:      si,
    }));

    const bowling = (inn.bowling || []).map((b, si) => ({
      name:    b.bowler?.name || '',
      overs:   b.o  || '0',
      maidens: b.m  ?? 0,
      runs:    b.r  ?? 0,
      wickets: b.w  ?? 0,
      economy: b.eco || '0.00',
      wides:   b.wd ?? 0,
      noBalls: b.nb ?? 0,
      sort:    si,
    }));

    // Score for this inning from the top-level score array
    const score = (d.score || []).find(s =>
      (s.inning || '').toLowerCase().includes(battingTeam.toLowerCase())
      && String(s.inning).match(/\d+/)?.[0] === String(idx + 1)
    ) || (d.score || [])[idx] || null;

    return {
      inningNum:   idx + 1,
      inning:      innName,
      battingTeam,
      bowlingTeam,
      score:       score ? { r: score.r, w: score.w, o: score.o } : null,
      batting,
      bowling,
    };
  });

  return innings;
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
