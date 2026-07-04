'use strict';

const express        = require('express');
const { getDb }      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const NOT_OUT_TYPES = ['dnb', 'notout'];

// Build the innings array for a match — cache-first from scorecard_json,
// otherwise built live from player_match_stats (whichever provider — CricketData
// or ESPN — last synced it). Pass { skipCache: true } to force a rebuild.
function buildScorecard(matchId, { skipCache = false } = {}) {
  const db    = getDb();
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return null;

  if (!skipCache && match.scorecard_json) {
    return JSON.parse(match.scorecard_json);
  }

  const stats = db.prepare(`
    SELECT pms.*, p.name, p.team, p.role, p.external_player_id
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    WHERE pms.match_id = ?
    AND pms.scoreboard IS NOT NULL
    ORDER BY pms.scoreboard, pms.sort_order
  `).all(matchId);

  // Group by innings.
  //
  // player_match_stats has ONE row per player per match — an all-rounder who
  // bats in one innings and bowls in the other has both sets of figures on
  // the same row, but only a single `scoreboard` label (batting always
  // overwrites it last in buildPlayerStatsFromScorecard). So a row's own
  // scoreboard is reliable for BATTING, but not for bowling — a bowler's
  // figures must be attributed to whichever innings has the opposing team
  // batting, not to their own row's scoreboard label.
  const innings = {};
  function ensureGroup(label) {
    if (!innings[label]) innings[label] = {
      scoreboard:  label,
      inningNum:   parseInt(label.replace(/\D/g, ''), 10) || 1,
      battingTeam: null,
      bowlingTeam: null,
      batting:     [],
      bowling:     [],
      runs:        0,
      wickets:     0,
      overs:       0,
    };
    return innings[label];
  }

  // Pass 1: batting
  for (const s of stats) {
    if (s.balls_faced > 0 || s.dismissal_type !== 'dnb') {
      const group = ensureGroup(s.scoreboard || 'I1');
      if (!group.battingTeam) group.battingTeam = s.match_team;
      group.batting.push({
        player_id: s.player_id,
        name: s.name,
        runs: s.runs,
        balls: s.balls_faced,
        fours: s.fours,
        sixes: s.sixes,
        strikeRate: s.balls_faced > 0 ? ((s.runs/s.balls_faced)*100).toFixed(2) : '0',
        dismissal: s.dismissal_type,
        bowlerName: s.bowler_name,
        catcherName: s.catcher_name,
        isActive: s.is_active,
        active: !!s.is_active,
      });
      group.runs += s.runs || 0;
      if (!NOT_OUT_TYPES.includes(s.dismissal_type)) group.wickets += 1;
    }
  }

  // Pass 2: bowling — attribute to the innings where the OPPOSING team bats
  const battingGroups = Object.values(innings);
  for (const s of stats) {
    if (s.overs_bowled > 0) {
      let group = battingGroups.find(g => g.battingTeam && g.battingTeam !== s.match_team);
      if (!group) group = ensureGroup(s.scoreboard || 'I1');
      if (!group.bowlingTeam) group.bowlingTeam = s.match_team;
      group.bowling.push({
        player_id: s.player_id,
        name: s.name,
        overs: s.overs_bowled,
        maidens: s.maidens,
        runs: s.runs_conceded,
        wickets: s.wickets,
        economy: s.overs_bowled > 0 ? (s.runs_conceded/s.overs_bowled).toFixed(2) : '0'
      });
      group.overs += s.overs_bowled || 0;
    }
  }

  return Object.values(innings).map(g => ({
    ...g,
    score: { r: g.runs, w: g.wickets, o: Math.round(g.overs * 10) / 10 },
  }));
}

// GET /api/scorecard/:matchId — serve from cache, build from player_match_stats otherwise
router.get('/:matchId', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  try {
    const cached  = !!match.scorecard_json;
    const innings = buildScorecard(matchId);

    // Freeze the scorecard for completed matches so we stop rebuilding it
    if (match.status === 'completed' && !cached) {
      db.prepare('UPDATE matches SET scorecard_json = ? WHERE id = ?')
        .run(JSON.stringify(innings), matchId);
    }

    return res.json({ innings, cached });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/scorecard/:matchId/refresh — force rebuild from player_match_stats
router.post('/:matchId/refresh', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const match   = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  try {
    const innings = buildScorecard(matchId, { skipCache: true });
    db.prepare('UPDATE matches SET scorecard_json = ? WHERE id = ?')
      .run(JSON.stringify(innings), matchId);
    return res.json({ innings, ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { router, buildScorecard };
