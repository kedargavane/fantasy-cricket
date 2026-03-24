'use strict';

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { smGet } = require('../api/sportmonks');

const router = express.Router();

// GET /api/scorecard/:matchId
// Fetches live scorecard directly from Sportmonks and returns structured innings
router.get('/:matchId', requireAuth, async (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const fixtureId = match.sportmonks_fixture_id;
  if (!fixtureId) return res.status(404).json({ error: 'No fixture ID' });

  try {
    const data = await smGet(`fixtures/${fixtureId}`, {
      include: 'batting,bowling,runs,localteam,visitorteam',
    });
    const f = data.data || {};

    const localTeamId   = f.localteam_id;
    const visitorTeamId = f.visitorteam_id;
    const localTeamName   = f.localteam?.name  || String(localTeamId);
    const visitorTeamName = f.visitorteam?.name || String(visitorTeamId);

    const teamName = id => id === localTeamId ? localTeamName : visitorTeamName;

    // Build innings map: { S1: { batting: [...], bowling: [...] }, S2: {...} }
    const innings = {};

    for (const b of (f.batting || [])) {
      const sb = b.scoreboard || 'S1';
      if (!innings[sb]) innings[sb] = { batting: [], bowling: [], battingTeamId: null, bowlingTeamId: null };
      innings[sb].battingTeamId = b.team_id;
      innings[sb].batting.push({
        player_id:  b.player_id,
        name:       null, // resolved below
        team_id:    b.team_id,
        team_name:  teamName(b.team_id),
        runs:       b.score,
        balls:      b.ball,
        fours:      b.four_x,
        sixes:      b.six_x,
        sort:       b.sort,
        active:     b.active,
        wicket_id:  b.wicket_id,
        bowling_player_id:    b.bowling_player_id,
        catch_stump_player_id: b.catch_stump_player_id,
      });
    }

    for (const b of (f.bowling || [])) {
      const sb = b.scoreboard || 'S1';
      if (!innings[sb]) innings[sb] = { batting: [], bowling: [], battingTeamId: null, bowlingTeamId: null };
      innings[sb].bowlingTeamId = b.team_id;
      innings[sb].bowling.push({
        player_id: b.player_id,
        name:      null,
        team_id:   b.team_id,
        team_name: teamName(b.team_id),
        overs:     b.overs,
        wickets:   b.wickets,
        runs:      b.runs,
        maidens:   b.medians,
        economy:   b.rate,
        sort:      b.sort,
      });
    }

    // Resolve player names from our DB
    const allPlayerIds = new Set([
      ...Object.values(innings).flatMap(i => i.batting.map(b => b.player_id)),
      ...Object.values(innings).flatMap(i => i.bowling.map(b => b.player_id)),
    ]);

    const playerNames = {};
    for (const pid of allPlayerIds) {
      const p = db.prepare(
        'SELECT name FROM players WHERE sportmonks_player_id = ? OR external_player_id = ?'
      ).get(pid, String(pid));
      if (p) playerNames[pid] = p.name;
    }

    // Apply names
    for (const inn of Object.values(innings)) {
      for (const b of inn.batting)  b.name = playerNames[b.player_id] || `Player ${b.player_id}`;
      for (const b of inn.bowling)  b.name = playerNames[b.player_id] || `Player ${b.player_id}`;
      // Sort batting by sort order, bowling by wickets desc
      inn.batting.sort((a,b) => a.sort - b.sort);
      inn.bowling.sort((a,b) => (b.wickets - a.wickets) || (a.sort - b.sort));
    }

    // Build innings score from runs
    const scores = {};
    for (const r of (f.runs || [])) {
      scores[r.scoreboard] = { r: r.score, w: r.wickets, o: r.overs, inning: r.inning };
    }

    const result = Object.entries(innings)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([sb, inn], idx) => ({
        scoreboard: sb,
        inningNum:  idx + 1,
        battingTeam: teamName(inn.battingTeamId),
        bowlingTeam: teamName(inn.bowlingTeamId),
        score:      scores[sb] || null,
        batting:    inn.batting,
        bowling:    inn.bowling,
      }));

    return res.json({ innings: result });
  } catch (err) {
    console.error('[scorecard]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
