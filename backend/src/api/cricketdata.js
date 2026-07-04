'use strict';

/**
 * CricketData (CricAPI) v1
 * Drop-in replacement for sportmonks.js — identical export shapes.
 * Base URL: https://api.cricapi.com/v1
 * Auth: apikey query param from process.env.CRICKETDATA_KEY
 */

const axios    = require('axios');
const BASE_URL = 'https://api.cricapi.com/v1';

function getKey() {
  const key = process.env.CRICKETDATA_KEY;
  if (!key) throw new Error('CRICKETDATA_KEY not set');
  return key;
}

async function cdGet(endpoint, params = {}) {
  const res = await axios.get(`${BASE_URL}/${endpoint}`, {
    params:  { apikey: getKey(), ...params },
    timeout: 15000,
  });
  if (res.data.status !== 'success') {
    throw new Error(`CricketData error [${endpoint}]: ${res.data.reason || res.data.status || 'unknown'}`);
  }
  return res.data;
}

// ── Role normalisation ────────────────────────────────────────────────────────
function normaliseRole(role) {
  if (!role) return 'batsman';
  const r = role.toLowerCase();
  if (r === 'wk-batsman' || r.includes('keeper') || r.startsWith('wk')) return 'wicketkeeper';
  if (r === 'batting allrounder' || r === 'bowling allrounder' || r.includes('allrounder')) return 'allrounder';
  if (r === 'bowler' || r.includes('bowl')) return 'bowler';
  return 'batsman';
}

// ── Dismissal normalisation ───────────────────────────────────────────────────
function normaliseDismissal(dismissalStr) {
  if (!dismissalStr) return 'notout';
  const d = dismissalStr.toLowerCase().trim();
  if (!d || d === 'not out' || d === 'notout' || d.startsWith('retired')) return 'notout';
  if (d === 'cb' || d === 'c&b' || d === 'caught and bowled') return 'caught';
  if (d === 'catch' || d === 'caught' || d.startsWith('c '))   return 'caught';
  if (d === 'bowled' || d === 'b' || d.startsWith('b '))       return 'bowled';
  if (d === 'lbw' || d.startsWith('lbw '))                     return 'lbw';
  if (d === 'runout' || d === 'run out' || d.startsWith('run out') || d.startsWith('runout')) return 'runout';
  if (d === 'stumped' || d.startsWith('st '))                  return 'stumped';
  if (d === 'hitwicket' || d === 'hit wicket')                 return 'hitwicket';
  return 'notout';
}

// ── Fetch match squad ─────────────────────────────────────────────────────────
function squadFromTeams(teams) {
  const players = [];
  for (const team of teams) {
    for (const p of (team.players || [])) {
      players.push({
        externalPlayerId: String(p.id),
        name:             p.name || '',
        role:             normaliseRole(p.role),
        team:             team.teamName || '',
        isPlayingXi:      false,
      });
    }
  }
  return players;
}

// GET /series_squad?id=seriesId
async function fetchSeriesSquad(seriesId) {
  const data  = await cdGet('series_squad', { id: seriesId });
  const teams = data.data || [];
  return squadFromTeams(teams);
}

// GET /match_squad?id=matchId — falls back to /series_squad if empty
async function fetchMatchSquad(matchId) {
  const data    = await cdGet('match_squad', { id: matchId });
  const players = squadFromTeams(data.data || []);
  if (players.length > 0) return players;

  // Fallback: series_squad using the same matchId
  try {
    const fallback = await cdGet('series_squad', { id: matchId });
    return squadFromTeams(fallback.data || []);
  } catch {
    return [];
  }
}

// ── Fetch fixture scorecard ───────────────────────────────────────────────────
// GET /match_info?id=matchId — returns scorecard, score, tossWinner and matchWinner
// in a single call when fantasyEnabled is true.
// Returns { matchInfo, playerStats } — identical shape to sportmonks.fetchFixtureScorecard
async function fetchFixtureScorecard(matchId) {
  const data = await cdGet('match_info', { id: matchId });
  const d    = data.data || {};

  const teamA = d.teams?.[0] || '';
  const teamB = d.teams?.[1] || '';

  const matchInfo = {
    externalMatchId: d.id,
    matchStarted:    !!d.matchStarted,
    matchEnded:      !!d.matchEnded,
    status:          d.matchEnded ? 'completed' : d.matchStarted ? 'live' : 'upcoming',
    teamA,
    teamB,
    tossWinner:  d.tossWinner  || null,
    tossChoice:  d.tossChoice  || null,
    matchWinner: d.matchWinner || null,
    score: (d.score || []).map(s => {
      // "India Inning 1" → "India" for teamName
      const teamName = s.inning
        ? s.inning.replace(/\s+Innings?\s*\d+\s*$/i, '').trim()
        : '';
      return { inning: s.inning, teamName, r: s.r, w: s.w, o: s.o };
    }),
  };

  return { matchInfo, playerStats: buildPlayerStatsFromScorecard(d.scorecard, teamA, teamB) };
}

// ── Build player stats from a CricketData scorecard[] array ───────────────────
// scorecard: [{ inning, batting: [], bowling: [], catching: [] }]
// Shared by fetchFixtureScorecard and admin's manual-scorecard entry route.
function buildPlayerStatsFromScorecard(scorecard, teamA, teamB) {
  // Build player stats map keyed by externalPlayerId
  const statsMap = {};

  function ensurePlayer(pid, name, team) {
    if (!statsMap[pid]) {
      statsMap[pid] = {
        externalPlayerId:    String(pid),
        name:                name || null,
        team:                team || '',
        runs:                0,
        ballsFaced:          0,
        fours:               0,
        sixes:               0,
        dismissalType:       'dnb',
        oversBowled:         0,
        wickets:             0,
        runsConceded:        0,
        maidens:             0,
        catches:             0,
        stumpings:           0,
        runOuts:             0,
        bowlerDismissalType: null,
        bowlerName:          null,
        catcherName:         null,
        runoutName:          null,
        bowlerId:            null,
        catcherId:           null,
        sortOrder:           99,
        scoreboard:          null,
      };
    }
    return statsMap[pid];
  }

  for (let innIdx = 0; innIdx < (scorecard || []).length; innIdx++) {
    const inn      = scorecard[innIdx];
    const innLabel = `I${innIdx + 1}`;
    const innName  = (inn.inning || '').toLowerCase();

    // Determine batting / bowling teams from the inning label string
    const battingTeam = innName.includes(teamA.toLowerCase()) ? teamA : teamB;
    const bowlingTeam = battingTeam === teamA ? teamB : teamA;

    // If catching[] is present use it as authoritative fielding source;
    // otherwise derive catches/stumpings/runOuts from batting dismissals below.
    const hasCatchingData = (inn.catching || []).length > 0;

    // ── Batting ──────────────────────────────────────────────────────────────
    for (let si = 0; si < (inn.batting || []).length; si++) {
      const b   = inn.batting[si];
      const pid = b.batsman?.id;
      if (!pid) continue;

      const p = ensurePlayer(pid, b.batsman?.name, battingTeam);
      p.scoreboard = innLabel;
      p.sortOrder  = si + 1;

      p.runs       += parseInt(b.r      || 0, 10);
      p.ballsFaced += parseInt(b.b      || 0, 10);
      p.fours      += parseInt(b['4s']  || 0, 10);
      p.sixes      += parseInt(b['6s']  || 0, 10);

      const dismissalText = b['dismissal-text'] || b.dismissal || '';
      const dismissal     = normaliseDismissal(dismissalText);
      p.dismissalType = dismissal;

      const bowlerId   = b.bowler?.id   || null;
      const bowlerName = b.bowler?.name || null;
      p.bowlerId   = bowlerId;
      p.bowlerName = bowlerName;

      // For caught-and-bowled the bowler is also the fielder
      let catcherId   = b.fielders?.[0]?.id   || null;
      let catcherName = b.fielders?.[0]?.name || null;
      if (dismissal === 'caught' && !catcherId && bowlerId) {
        catcherId   = bowlerId;
        catcherName = bowlerName;
      }

      // Always store catcher/runout names on the batsman for display
      if (dismissal === 'caught' || dismissal === 'stumped') {
        p.catcherId   = catcherId;
        p.catcherName = catcherName;
      } else if (dismissal === 'runout') {
        p.runoutName = catcherName;
      }

      if (!hasCatchingData) {
        // Derive fielding stats from batting dismissals
        if (dismissal === 'caught' && catcherId) {
          ensurePlayer(catcherId, catcherName, bowlingTeam).catches   += 1;
        } else if (dismissal === 'stumped' && catcherId) {
          ensurePlayer(catcherId, catcherName, bowlingTeam).stumpings += 1;
        } else if (dismissal === 'runout' && catcherId) {
          ensurePlayer(catcherId, catcherName, bowlingTeam).runOuts   += 1;
        }
        // LBW / bowled bonus credited to the bowler
        if ((dismissal === 'lbw' || dismissal === 'bowled') && bowlerId) {
          ensurePlayer(bowlerId, bowlerName, bowlingTeam).bowlerDismissalType = dismissal;
        }
      }
    }

    // ── Bowling ──────────────────────────────────────────────────────────────
    for (const b of (inn.bowling || [])) {
      const pid = b.bowler?.id;
      if (!pid) continue;
      const p = ensurePlayer(pid, b.bowler?.name, bowlingTeam);
      if (!p.scoreboard) p.scoreboard = innLabel;

      p.oversBowled  += parseFloat(b.o || 0);
      p.maidens      += parseInt(b.m   || 0, 10);
      p.runsConceded += parseInt(b.r   || 0, 10);
      p.wickets      += parseInt(b.w   || 0, 10);
    }

    // ── Fielding from catching[] (authoritative when present) ─────────────────
    for (const c of (inn.catching || [])) {
      const pid = c.catcher?.id;
      if (!pid) continue;
      const p = ensurePlayer(pid, c.catcher?.name, bowlingTeam);
      p.catches   += parseInt(c.catch   || 0, 10);
      p.stumpings += parseInt(c.stumped || 0, 10);
      p.runOuts   += parseInt(c.runout  || 0, 10);
      // bowler dismissal bonus (lbw/bowled count on the bowler row)
      if ((c.lbw || 0) > 0 || (c.bowled || 0) > 0) {
        p.bowlerDismissalType = (c.lbw || 0) > 0 ? 'lbw' : 'bowled';
      }
    }
  }

  return Object.values(statsMap);
}

// ── Fetch match info (lightweight status check) ───────────────────────────────
// Equivalent to sportmonks.fetchFixtureInfo
async function fetchMatchInfo(matchId) {
  const data = await cdGet('match_info', { id: matchId });
  const d    = data.data || {};
  return {
    externalMatchId: d.id,
    status:          d.status    || '',
    matchStarted:    !!d.matchStarted,
    matchEnded:      !!d.matchEnded,
    hasSquad:        !!d.hasSquad,
    fantasyEnabled:  !!d.fantasyEnabled,
    bbbEnabled:      !!d.bbbEnabled,
    tossWinner:      d.tossWinner || null,
    tossChoice:      d.tossChoice || null,
    tossInfo:        d.tossWinner
      ? `${d.tossWinner} won the toss and chose to ${d.tossChoice || 'bat'}`
      : null,
    trulyFinished:   d.matchEnded === true,
    // Alias o → overs so cronJobs ball-counting logic (s.overs) works unchanged
    score: (d.score || []).map(s => ({ ...s, overs: s.o })),
    venueInfo: d.venue || null,
  };
}

// ── Fetch all live / recently started matches ─────────────────────────────────
// Equivalent to sportmonks.fetchLivescores
async function fetchLivescores() {
  const data = await cdGet('currentMatches');
  return (data.data || [])
    .filter(f => f.matchStarted === true)
    .map(f => ({
      externalMatchId: f.id,
      teamA:           f.teams?.[0] || '',
      teamB:           f.teams?.[1] || '',
      status:          f.status     || '',
      score:           f.score      || [],
      matchStarted:    !!f.matchStarted,
      matchEnded:      !!f.matchEnded,
    }));
}

// ── Fetch all matches in a series ─────────────────────────────────────────────
async function fetchSeriesMatches(seriesId) {
  const data = await cdGet('series_info', { id: seriesId });
  return (data.data?.matchList || []).map(m => ({
    externalMatchId: m.id,
    name:            m.name           || '',
    matchType:       (m.matchType || 't20').toLowerCase(),
    date:            m.date           || '',
    dateTimeGMT:     m.dateTimeGMT    || '',
    teams:           m.teams          || [],
    status:          m.status         || '',
    matchStarted:    !!m.matchStarted,
    matchEnded:      !!m.matchEnded,
    hasSquad:        !!m.hasSquad,
    fantasyEnabled:  !!m.fantasyEnabled,
  }));
}

// ── Fetch player info ─────────────────────────────────────────────────────────
async function fetchPlayerById(playerId) {
  const data = await cdGet('players_info', { id: playerId });
  const p    = data.data || {};
  return {
    id:      p.id      || playerId,
    name:    p.name    || '',
    role:    normaliseRole(p.role),
    country: p.country || '',
  };
}

module.exports = {
  cdGet,
  normaliseRole,
  normaliseDismissal,
  fetchSeriesSquad,
  fetchMatchSquad,
  fetchFixtureScorecard,
  buildPlayerStatsFromScorecard,
  fetchMatchInfo,
  fetchLivescores,
  fetchSeriesMatches,
  fetchPlayerById,
};
