'use strict';

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { smGet } = require('../api/sportmonks');

const router = express.Router();

function lastName(name) {
  if (!name) return '';
  return name.split(' ').pop();
}

// Build scorecard innings from Sportmonks fixture data
async function buildScorecard(fixtureId, db) {
  const data = await smGet(`fixtures/${fixtureId}`, {
    include: 'batting,bowling,runs,localteam,visitorteam',
  });
  const f = data.data || {};

  const localTeamId     = f.localteam_id;
  const visitorTeamId   = f.visitorteam_id;
  const localTeamName   = f.localteam?.name  || String(localTeamId);
  const visitorTeamName = f.visitorteam?.name || String(visitorTeamId);
  const teamName = id => id === localTeamId ? localTeamName : visitorTeamName;

  // Collect all player IDs and resolve names from DB
  const allPids = new Set([
    ...(f.batting  || []).map(b => b.player_id),
    ...(f.bowling  || []).map(b => b.player_id),
    ...(f.batting  || []).flatMap(b => [b.bowling_player_id, b.catch_stump_player_id, b.runout_by_id].filter(Boolean)),
  ]);
  const playerNames = {};
  for (const pid of allPids) {
    const p = db.prepare(
      'SELECT name FROM players WHERE sportmonks_player_id = ? OR external_player_id = ?'
    ).get(pid, String(pid));
    if (p) playerNames[pid] = p.name;
  }
  const pname = id => id ? (playerNames[id] || `#${id}`) : null;

  // Build innings
  const inningsMap = {};
  for (const b of (f.batting || [])) {
    const sb = b.scoreboard || 'S1';
    if (!inningsMap[sb]) inningsMap[sb] = { battingTeamId: null, batting: [], bowling: [] };
    inningsMap[sb].battingTeamId = b.team_id;
    inningsMap[sb].batting.push({
      player_id: b.player_id,
      name:      pname(b.player_id),
      runs:      b.score,
      balls:     b.ball,
      fours:     b.four_x,
      sixes:     b.six_x,
      sort:      b.sort,
      active:    b.active,
      wicket_id: b.wicket_id,
    });
  }
  for (const b of (f.bowling || [])) {
    const sb = b.scoreboard || 'S1';
    if (!inningsMap[sb]) inningsMap[sb] = { battingTeamId: null, batting: [], bowling: [] };
    inningsMap[sb].bowling.push({
      player_id: b.player_id,
      name:      pname(b.player_id),
      overs:     b.overs,
      wickets:   b.wickets,
      runs:      b.runs,
      maidens:   b.medians,
      economy:   b.rate,
      sort:      b.sort,
    });
  }

  // Runs index
  const runsMap = {};
  for (const r of (f.runs || [])) runsMap[r.scoreboard] = r;

  // Sort and structure
  const innings = Object.entries(inningsMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([sb, inn], idx) => {
      const bowlingTeamId = inn.battingTeamId === localTeamId ? visitorTeamId : localTeamId;
      const r = runsMap[sb];
      inn.batting.sort((a,b) => a.sort - b.sort);
      inn.bowling.sort((a,b) => (b.wickets - a.wickets) || (a.sort - b.sort));
      return {
        scoreboard:  sb,
        inningNum:   idx + 1,
        battingTeam: teamName(inn.battingTeamId),
        bowlingTeam: teamName(bowlingTeamId),
        score:       r ? { r: r.score, w: r.wickets, o: r.overs } : null,
        batting:     inn.batting,
        bowling:     inn.bowling,
      };
    });

  return innings;
}

// GET /api/scorecard/:matchId — serve from cache, refresh if live
router.get('/:matchId', requireAuth, async (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  // Serve cached scorecard if completed match
  if (match.status === 'completed' && match.scorecard_json) {
    return res.json({ innings: JSON.parse(match.scorecard_json), cached: true });
  }

  // Fetch live from Sportmonks
  try {
    const innings = await buildScorecard(match.sportmonks_fixture_id, db);
    // Cache if completed
    if (match.status === 'completed') {
      db.prepare('UPDATE matches SET scorecard_json = ? WHERE id = ?')
        .run(JSON.stringify(innings), matchId);
    }
    return res.json({ innings, cached: false });
  } catch (err) {
    // Fallback to cache even if stale
    if (match.scorecard_json) {
      return res.json({ innings: JSON.parse(match.scorecard_json), cached: true, stale: true });
    }
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/scorecard/:matchId/refresh — force refresh from Sportmonks
router.post('/:matchId/refresh', requireAuth, async (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  try {
    const innings = await buildScorecard(match.sportmonks_fixture_id, db);
    db.prepare('UPDATE matches SET scorecard_json = ? WHERE id = ?')
      .run(JSON.stringify(innings), matchId);
    return res.json({ innings, ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { router, buildScorecard };
