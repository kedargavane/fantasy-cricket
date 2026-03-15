'use strict';

const https   = require('https');
const axios   = require('axios');

const BASE_URL = process.env.CRICAPI_BASE_URL || 'https://api.cricapi.com/v1';

// Keep-alive agent — reuses TCP connections, more reliable on Railway
const httpsAgent = new https.Agent({ keepAlive: true });

function getApiKey() {
  const key = process.env.CRICAPI_KEY;
  if (!key) throw new Error('CRICAPI_KEY environment variable not set');
  return key;
}

async function cricGet(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set('apikey', getApiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const data = await new Promise((resolve, reject) => {
    const req = https.get(url.toString(), { agent: httpsAgent }, (res) => {
      let body = '';
      res.setTimeout(8000, () => { req.destroy(); reject(new Error('response timeout')); });
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    // Socket timeout — abandon if no connection in 8s
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('socket timeout')); });
    req.on('error', reject);
  });

  if (!data || data.status !== 'success') {
    throw new Error(`CricAPI ${endpoint}: ${data?.status} — ${data?.reason || 'unknown'}`);
  }
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch upcoming + recent matches for a series.
 * Maps to our MATCHES table.
 */
async function fetchSeriesMatches(seriesId) {
  const data = await cricGet('series_info', { id: seriesId });
  const matchList = data.data?.matchList || [];

  return matchList.map(m => ({
    externalMatchId: m.id,
    name:            m.name,
    teamA:           m.teams?.[0] || '',
    teamB:           m.teams?.[1] || '',
    venue:           m.venue || '',
    matchType:       normaliseMatchType(m.matchType),
    status:          normaliseStatus(m.matchStarted, m.matchEnded),
    startTime:       m.dateTimeGMT || m.date || '',
  }));
}

/**
 * Fetch Playing XI and full squad for a match.
 * Maps to MATCH_SQUADS + PLAYERS tables.
 */
async function fetchMatchSquad(matchId) {
  const data = await cricGet('match_squad', { id: matchId });
  const squads = data.data || [];

  const players = [];

  for (const team of squads) {
    // CricAPI returns teamName (not team) in match_squad response
    const teamName = team.teamName || team.team || team.name || '';
    for (const player of (team.players || [])) {
      players.push({
        externalPlayerId: player.id,
        name:             player.name,
        team:             teamName,
        role:             normaliseRole(player.role),
        isPlayingXi:      player.playing11 === true || player.playing11 === 'true',
      });
    }
  }

  return players;
}

/**
 * Fetch live / completed scorecard for a match.
 * Maps to PLAYER_MATCH_STATS table.
 */
async function fetchMatchScorecard(matchId) {
  const data = await cricGet('match_scorecard', { id: matchId });
  const match = data.data || {};

  const matchInfo = {
    externalMatchId: match.id,
    matchStarted:    match.matchStarted === true,
    matchEnded:      match.matchEnded   === true,
    status:          match.status || '',
    teamA:           match.teams?.[0] || '',
    teamB:           match.teams?.[1] || '',
  };

  const playerStats = extractPlayerStats(match);

  return { matchInfo, playerStats };
}

/**
 * Fetch basic match info (status, start time).
 * Used by the polling cron to decide whether to do a full sync.
 */
async function fetchMatchInfo(matchId) {
  const data = await cricGet('match_info', { id: matchId });
  const match = data.data || {};

  return {
    externalMatchId: match.id,
    matchStarted:    match.matchStarted === true,
    matchEnded:      match.matchEnded   === true,
    status:          match.status || '',
    dateTimeGMT:     match.dateTimeGMT || '',
    // score array used by poller to extract ball count without full scorecard
    score:           match.score || [],
  };
}

// ── Stat extraction ───────────────────────────────────────────────────────────

/**
 * Extract per-player stats from a scorecard response.
 * Returns array of stat objects keyed by externalPlayerId.
 *
 * Handles:
 *  - Batting stats per innings
 *  - Bowling stats per innings
 *  - Fielding stats from the fielding table
 *  - dismissalType for LBW/bowled bonus
 */
function extractPlayerStats(match) {
  const statsMap = {}; // keyed by externalPlayerId

  function ensurePlayer(pid, name, team) {
    if (!statsMap[pid]) {
      statsMap[pid] = {
        externalPlayerId: pid,
        name,
        team,
        runs:          0,
        ballsFaced:    0,
        fours:         0,
        sixes:         0,
        dismissalType: 'dnb',   // did not bat — default
        oversBowled:   0,
        wickets:       0,
        runsConceded:  0,
        maidens:       0,
        catches:       0,
        stumpings:     0,
        runOuts:       0,
        // For LBW/bowled bonus — list of dismissal types this bowler caused
        bowlerDismissals: [],
      };
    }
    return statsMap[pid];
  }

  const scorecard = match.scorecard || [];

  for (const innings of scorecard) {
    const teamName = innings.inningsTeam || '';

    // ── Batting ──
    for (const batter of (innings.batting || [])) {
      const pid = batter.batsman?.id;
      if (!pid) continue;

      const p = ensurePlayer(pid, batter.batsman?.name || '', teamName);
      p.runs       += parseInt(batter.r  || 0, 10);
      p.ballsFaced += parseInt(batter.b  || 0, 10);
      p.fours      += parseInt(batter['4s'] || 0, 10);
      p.sixes      += parseInt(batter['6s'] || 0, 10);

      // Dismissal type — use last non-dnb value
      const dismissal = normaliseDismissal(batter.dismissal || batter.out_desc || '');
      if (dismissal !== 'dnb') p.dismissalType = dismissal;

      // Credit LBW/bowled to the bowler
      if ((dismissal === 'lbw' || dismissal === 'bowled') && batter.bowler?.id) {
        const bowlerPid = batter.bowler.id;
        ensurePlayer(bowlerPid, batter.bowler.name || '', '');
        statsMap[bowlerPid].bowlerDismissals.push(dismissal);
      }
    }

    // ── Bowling ──
    for (const bowler of (innings.bowling || [])) {
      const pid = bowler.bowler?.id;
      if (!pid) continue;

      const p = ensurePlayer(pid, bowler.bowler?.name || '', '');
      p.oversBowled  += parseFloat(bowler.o  || 0);
      p.wickets      += parseInt(bowler.w    || 0, 10);
      p.runsConceded += parseInt(bowler.r    || 0, 10);
      p.maidens      += parseInt(bowler.m    || 0, 10);
    }

    // ── Fielding ──
    for (const fielder of (innings.fielding || [])) {
      const pid = fielder.fielder?.id;
      if (!pid) continue;

      const p = ensurePlayer(pid, fielder.fielder?.name || '', '');
      p.catches   += parseInt(fielder.catch    || fielder.Catch    || 0, 10);
      p.stumpings += parseInt(fielder.stumping || fielder.Stumped  || 0, 10);
      p.runOuts   += parseInt(fielder.runout   || fielder.Runout   || 0, 10);
    }
  }

  // Resolve bowlerDismissalType for scoring engine
  // The scoring engine uses bowlerDismissalType as the LAST relevant dismissal
  // For simplicity: if bowler caused any LBW/bowled dismissal, flag it
  for (const stat of Object.values(statsMap)) {
    if (stat.bowlerDismissals.length > 0) {
      stat.bowlerDismissalType = stat.bowlerDismissals[0]; // first is sufficient for bonus
    }
    delete stat.bowlerDismissals;
  }

  return Object.values(statsMap);
}

// ── Normalisers ───────────────────────────────────────────────────────────────

function normaliseMatchType(type) {
  if (!type) return 't20';
  const t = type.toLowerCase();
  if (t.includes('test'))  return 'test';
  if (t.includes('odi') || t.includes('one day')) return 'odi';
  return 't20';
}

function normaliseStatus(matchStarted, matchEnded) {
  if (matchEnded)   return 'completed';
  if (matchStarted) return 'live';
  return 'upcoming';
}

function normaliseRole(role) {
  if (!role) return null;
  const r = role.toLowerCase();
  if (r.includes('keeper') || r.includes('wk'))  return 'wicketkeeper';
  if (r.includes('all'))                          return 'allrounder';
  if (r.includes('bowl'))                         return 'bowler';
  if (r.includes('bat'))                          return 'batsman';
  return null;
}

function normaliseDismissal(desc) {
  if (!desc || desc.trim() === '' || desc.toLowerCase().includes('not out')) return 'notout';
  const d = desc.toLowerCase();
  if (d.startsWith('lbw'))     return 'lbw';
  if (d.startsWith('b ') || d === 'bowled') return 'bowled';
  if (d.includes('c ') || d.includes('caught')) return 'caught';
  if (d.includes('run out'))   return 'runout';
  if (d.includes('st ') || d.includes('stumped')) return 'stumped';
  if (d.includes('hit wicket')) return 'hitwicket';
  if (d.includes('retired'))   return 'retired';
  return 'notout';
}

module.exports = {
  fetchSeriesMatches,
  fetchMatchSquad,
  fetchMatchScorecard,
  fetchMatchInfo,
  extractPlayerStats,     // exported for testing
  normaliseDismissal,     // exported for testing
  normaliseMatchType,
};

// Export cricGet as cricGetPublic for use by autoSchedule
module.exports.cricGetPublic = cricGet;
