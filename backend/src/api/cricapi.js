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
    startTime:       m.dateTimeGMT
      ? (m.dateTimeGMT.endsWith('Z') ? m.dateTimeGMT : m.dateTimeGMT + 'Z')
      : (m.date || ''),
    hasSquad:        m.hasSquad || false,
    fantasyEnabled:  m.fantasyEnabled || false,
    matchStarted:    m.matchStarted || false,
    matchEnded:      m.matchEnded || false,
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
async function fetchMatchScorecard(matchId, teamA, teamB) {
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
async function fetchMatchXi(matchId) {
  const data = await cricGet('match_xi', { id: matchId });
  const teams = data.data || [];
  // Returns array of {teamName, players: [{id, name, role, ...}]}
  const players = [];
  for (const team of teams) {
    for (const p of (team.players || [])) {
      if (p.id) players.push({ id: p.id, name: p.name, isPlayingXi: true });
    }
  }
  return players; // list of confirmed XI players
}

// Fetch live scores from cricScore endpoint — works for all matches including LLC
// Returns match-level scores (not per-player)
async function fetchCricScore(externalMatchId) {
  const data = await cricGet('cricScore', {});
  const matches = data.data || [];
  const match = matches.find(m => m.id === externalMatchId);
  if (!match) return null;
  return {
    externalMatchId: match.id,
    status:     match.status || '',
    ms:         match.ms || '',   // 'live' | 'fixture' | 'result'
    t1:         match.t1  || '',
    t2:         match.t2  || '',
    t1Score:    match.t1s || '',  // e.g. "152/9 (20)"
    t2Score:    match.t2s || '',
    matchEnded: match.ms === 'result',
    matchStarted: match.ms === 'live' || match.ms === 'result',
  };
}

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

  // Build a map of all known teams from scorecard innings
  // "Bangladesh Inning 1" → batting team is "Bangladesh"
  // "india captains Inning 1" → batting team is "india captains"
  const allTeams = [];
  for (const innings of scorecard) {
    const inningStr = innings.inning || innings.inningsTeam || '';
    const battingTeam = inningStr.replace(/\s+Inning\s+\d+.*$/i, '').trim();
    if (battingTeam && !allTeams.includes(battingTeam)) allTeams.push(battingTeam);
  }

  // Also extract team names from batting rows (player.team field if available)
  // This helps when inning strings repeat the same team name
  for (const innings of scorecard) {
    for (const b of (innings.batting || [])) {
      const t = b.batsman?.team || b.team || '';
      if (t && !allTeams.includes(t)) allTeams.push(t);
    }
    for (const b of (innings.bowling || [])) {
      const t = b.bowler?.team || b.team || '';
      if (t && !allTeams.includes(t)) allTeams.push(t);
    }
  }

  // Get match teams from match info for reliable bowling team assignment
  const matchTeamA = (match.teams?.[0] || '').trim();
  const matchTeamB = (match.teams?.[1] || '').trim();

  for (const innings of scorecard) {
    const inningStr   = innings.inning || innings.inningsTeam || '';
    const battingTeam = inningStr.replace(/\s+Inning\s+\d+.*$/i, '').trim();

    // Bowling team: use match teams if available, otherwise fall back to allTeams
    let bowlingTeam = allTeams.find(t => t !== battingTeam) || allTeams[1] || '';

    // Better: use match.teams to find the opposition
    if (matchTeamA && matchTeamB) {
      const battingNorm = battingTeam.toLowerCase();
      const teamANorm   = matchTeamA.toLowerCase();
      const teamBNorm   = matchTeamB.toLowerCase();
      if (teamANorm.includes(battingNorm) || battingNorm.includes(teamANorm)) {
        bowlingTeam = matchTeamB;
      } else if (teamBNorm.includes(battingNorm) || battingNorm.includes(teamBNorm)) {
        bowlingTeam = matchTeamA;
      }
    }

    // ── Batting ──
    for (const batter of (innings.batting || [])) {
      const pid = batter.batsman?.id;
      if (!pid) continue;

      const p = ensurePlayer(pid, batter.batsman?.name || '', battingTeam);
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
        ensurePlayer(bowlerPid, batter.bowler.name || '', bowlingTeam);
        statsMap[bowlerPid].bowlerDismissals.push(dismissal);
      }
    }

    // ── Bowling ──
    for (const bowler of (innings.bowling || [])) {
      const pid = bowler.bowler?.id;
      if (!pid) continue;

      // Bowlers bowl in the opposition's innings — assign bowling team
      const p = ensurePlayer(pid, bowler.bowler?.name || '', bowlingTeam);
      p.oversBowled  += parseFloat(bowler.o  || 0);
      p.wickets      += parseInt(bowler.w    || 0, 10);
      p.runsConceded += parseInt(bowler.r    || 0, 10);
      p.maidens      += parseInt(bowler.m    || 0, 10);
    }

    // ── Fielding ──
    for (const fielder of (innings.fielding || [])) {
      const pid = fielder.fielder?.id;
      if (!pid) continue;

      // Fielders field in the opposition's innings — assign bowling team
      const p = ensurePlayer(pid, fielder.fielder?.name || '', bowlingTeam);
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
  fetchCricScore,
  fetchMatchXi,
  fetchMatchScorecard,
  fetchMatchInfo,
  extractPlayerStats,     // exported for testing
  normaliseDismissal,     // exported for testing
  normaliseMatchType,
};

// Export cricGet as cricGetPublic for use by autoSchedule
module.exports.cricGetPublic = cricGet;
