'use strict';

/**
 * Sportmonks Cricket API v2.0
 * Single source of truth for all cricket data.
 * Base URL: https://cricket.sportmonks.com/api/v2.0
 */

const axios    = require('axios');
const BASE_URL = 'https://cricket.sportmonks.com/api/v2.0';

function getToken() {
  const token = process.env.SPORTMONKS_TOKEN;
  if (!token) throw new Error('SPORTMONKS_TOKEN not set');
  return token;
}

async function smGet(endpoint, params = {}) {
  const res = await axios.get(`${BASE_URL}/${endpoint}`, {
    params:  { api_token: getToken(), ...params },
    timeout: 15000,
  });
  return res.data;
}

// ── Role normalisation ────────────────────────────────────────────────────────
function normaliseRole(position) {
  if (!position) return 'batsman';
  const p = position.toLowerCase();
  if (p.includes('keeper') || p.includes('wk'))   return 'wicketkeeper';
  if (p.includes('all'))                           return 'allrounder';
  if (p.includes('bowl'))                          return 'bowler';
  return 'batsman';
}

// ── Dismissal normalisation ───────────────────────────────────────────────────
function normaliseDismissal(wicketId) {
  // Sportmonks wicket IDs: https://docs.sportmonks.com
  // Common: 1=bowled, 2=caught, 3=lbw, 4=run out, 5=stumped, 6=hit wicket
  // 7=obstructing, 8=timed out, 9=handled ball, 54=not out, 79=various
  if (!wicketId) return 'notout';
  if (wicketId === 54) return 'notout';
  if (wicketId === 1)  return 'bowled';
  if (wicketId === 3)  return 'lbw';
  if (wicketId === 2)  return 'caught';
  if (wicketId === 4)  return 'runout';
  if (wicketId === 5)  return 'stumped';
  return 'caught'; // default non-notout
}

// ── Fetch all fixtures for a season ──────────────────────────────────────────
async function fetchSeasonFixtures(seasonId) {
  const data = await smGet(`seasons/${seasonId}`, { include: 'fixtures' });
  const fixtures = data.data?.fixtures || [];
  return fixtures.map(f => ({
    sportmonksFixtureId: f.id,
    localteamId:         f.localteam_id,
    visitorteamId:       f.visitorteam_id,
    startingAt:          f.starting_at,
    status:              f.status, // NS, Live, Finished, Aban., Postp.
    round:               f.round || '',
    venueId:             f.venue_id,
  }));
}

// ── Fetch team by ID ──────────────────────────────────────────────────────────
async function fetchTeamById(teamId) {
  const data = await smGet(`teams/${teamId}`);
  return {
    id:   data.data?.id,
    name: data.data?.name || '',
    code: data.data?.code || '',
  };
}

// ── Fetch player by ID ────────────────────────────────────────────────────────
async function fetchPlayerById(playerId) {
  const data = await smGet(`players/${playerId}`, { include: 'position' });
  const p = data.data || {};
  const name = p.fullname || `${p.firstname || ''} ${p.lastname || ''}`.trim();
  const position = p.position?.name || '';
  return {
    id:   p.id,
    name,
    role: normaliseRole(position),
  };
}

// ── Fetch fixture scorecard ───────────────────────────────────────────────────
// Returns matchInfo + playerStats array ready for upsertStats
async function fetchFixtureScorecard(fixtureId) {
  const data = await smGet(`fixtures/${fixtureId}`, {
    include: 'batting,bowling,runs,localteam,visitorteam,lineup',
  });
  const f = data.data || {};

  const localTeamId   = f.localteam_id;
  const visitorTeamId = f.visitorteam_id;
  const localTeamName   = f.localteam?.name  || String(localTeamId);
  const visitorTeamName = f.visitorteam?.name || String(visitorTeamId);

  const statusMap = {
    'Finished': 'completed',
    'Live':     'live',
    'NS':       'upcoming',
    'Aban.':    'abandoned',
    'Postp.':   'upcoming',
  };

  const LIVE_STATUSES = new Set(['Live','1st Innings','2nd Innings','3rd Innings','4th Innings','Innings Break','Lunch','Tea','Stumps','Int.']);
  const matchInfo = {
    sportmonksFixtureId: f.id,
    matchStarted: LIVE_STATUSES.has(f.status) || f.status === 'Finished',
    matchEnded:   f.status === 'Finished' || f.status === 'Aban.',
    status:       statusMap[f.status] || (LIVE_STATUSES.has(f.status) ? 'live' : 'upcoming'),
    teamA:        localTeamName,
    teamB:        visitorTeamName,
    localTeamId:  localTeamId,
    visitorTeamId: visitorTeamId,
    score:        (f.runs || []).map(r => ({
      inning:  r.inning,
      teamId:  r.team_id,
      teamName: r.team_id === localTeamId ? localTeamName : visitorTeamName,
      r:       r.score,
      w:       r.wickets,
      o:       r.overs,
    })),
  };

  // Build player name lookup from lineup + batting + bowling entries
  const lineupNames = {};
  // From lineup (most complete)
  for (const p of (f.lineup || [])) {
    if (p.id) lineupNames[p.id] = p.fullname || `${p.firstname||''} ${p.lastname||''}`.trim();
  }
  // From batting entries (have player objects in some API versions)
  for (const b of (f.batting || [])) {
    if (b.player?.id) lineupNames[b.player.id] = b.player.fullname || '';
    if (b.batsmanout?.id) lineupNames[b.batsmanout.id] = b.batsmanout.fullname || '';
    if (b.bowler?.id) lineupNames[b.bowler.id] = b.bowler.fullname || '';
    if (b.catchstump?.id) lineupNames[b.catchstump.id] = b.catchstump.fullname || '';
  }

  // Build player stats map keyed by sportmonks player_id
  const statsMap = {};

  function ensurePlayer(pid, teamId) {
    if (!statsMap[pid]) {
      statsMap[pid] = {
        externalPlayerId: String(pid),
        name:             lineupNames[pid] || null,
        team:             teamId === localTeamId ? localTeamName : visitorTeamName,
        runs:             0,
        ballsFaced:       0,
        fours:            0,
        sixes:            0,
        dismissalType:    'dnb',
        oversBowled:      0,
        wickets:          0,
        runsConceded:     0,
        maidens:          0,
        catches:          0,
        stumpings:        0,
        runOuts:          0,
        bowlerDismissals: [],
      };
    }
    return statsMap[pid];
  }

  // ── Batting ──
  for (const b of (f.batting || [])) {
    const pid = b.player_id;
    if (!pid) continue;
    const p = ensurePlayer(pid, b.team_id);
    p.runs       = parseInt(b.score  || 0, 10);
    p.ballsFaced = parseInt(b.ball   || 0, 10);
    p.fours      = parseInt(b.four_x || 0, 10);
    p.sixes      = parseInt(b.six_x  || 0, 10);
    p.dismissalType = normaliseDismissal(b.wicket_id);
    p.scoreboard = b.scoreboard; // S1 or S2
    p.active     = b.active;     // currently batting
    p.sortOrder  = b.sort || 99;

    // Dismissal details for scorecard display
    p.bowlerName   = b.bowling_player_id   ? (lineupNames[b.bowling_player_id]   || null) : null;
    p.catcherName  = b.catch_stump_player_id ? (lineupNames[b.catch_stump_player_id] || null) : null;
    p.runoutName   = b.runout_by_id        ? (lineupNames[b.runout_by_id]        || null) : null;
    p.bowlerId     = b.bowling_player_id   || null;
    p.catcherId    = b.catch_stump_player_id || null;

    // LBW/bowled bonus
    if ((p.dismissalType === 'lbw' || p.dismissalType === 'bowled') && b.bowling_player_id) {
      const bowlerPid = b.bowling_player_id;
      ensurePlayer(bowlerPid, b.team_id === localTeamId ? visitorTeamId : localTeamId);
      statsMap[bowlerPid].bowlerDismissals.push(p.dismissalType);
    }
  }

  // ── Bowling ──
  for (const b of (f.bowling || [])) {
    const pid = b.player_id;
    if (!pid) continue;
    // Bowler's team is opposite of batting team (scoreboard S1/S2)
    const battingTeamId = b.scoreboard === 'S1' ? localTeamId : visitorTeamId;
    const bowlingTeamId = battingTeamId === localTeamId ? visitorTeamId : localTeamId;
    const p = ensurePlayer(pid, bowlingTeamId);
    p.scoreboard = b.scoreboard; // S1 bowlers bowl in 1st innings

    // Parse overs: Sportmonks stores as decimal e.g. 3.4 = 3 overs 4 balls
    const rawOvers = parseFloat(b.overs || 0);
    p.oversBowled   = rawOvers;
    p.wickets       = parseInt(b.wickets || 0, 10);
    p.runsConceded  = parseInt(b.runs    || 0, 10);
    p.maidens       = parseInt(b.maiden || b.medians || 0, 10);
  }

  const playerStats = Object.values(statsMap);
  return { matchInfo, playerStats };
}

// ── Fetch squad by team and season ──────────────────────────────────────────
// Returns full squad for a team in a season (pre-match, no toss needed)
async function fetchSquadByTeamAndSeason(teamId, smSeasonId) {
  const data = await smGet(`teams/${teamId}/squad/${smSeasonId}`);
  const team  = data.data || {};
  const squad = team.squad || [];
  return squad.map(p => ({
    externalPlayerId:   String(p.id),
    sportmonksPlayerId: p.id,
    name:  p.fullname || `${p.firstname || ''} ${p.lastname || ''}`.trim(),
    teamId: teamId,
    role:  normaliseRole(p.position?.name),
    isPlayingXi: false,
  }));
}

// ── Fetch lineup (playing XI) for a fixture ───────────────────────────────────
async function fetchFixtureLineup(fixtureId) {
  const data = await smGet(`fixtures/${fixtureId}`, { include: 'lineup' });
  const lineup = data.data?.lineup || [];
  return lineup.map(p => ({
    externalPlayerId: String(p.id || p.player_id),
    teamId:           p.lineup?.team_id || p.team_id,
    isPlayingXi:      true,
  }));
}

// ── Fetch all currently live fixtures ────────────────────────────────────────
async function fetchLivescores() {
  const data = await smGet('livescores', { include: 'localteam,visitorteam,runs' });
  return (data.data || []).map(f => ({
    sportmonksFixtureId: f.id,
    localTeamName:       f.localteam?.name  || '',
    visitorTeamName:     f.visitorteam?.name || '',
    status:              f.status,
    score:               f.runs || [],
  }));
}

// ── Fetch fixture basic info (for status check) ───────────────────────────────
async function fetchFixtureInfo(fixtureId) {
  const data = await smGet(`fixtures/${fixtureId}`, { include: 'runs' });
  const f = data.data || {};
  return {
    sportmonksFixtureId: f.id,
    status:   f.status,
    live:     f.live,
    score:    f.runs || [],
  };
}

module.exports = {
  fetchSeasonFixtures,
  fetchTeamById,
  fetchPlayerById,
  fetchFixtureScorecard,
  fetchSquadByTeamAndSeason,
  fetchFixtureLineup,
  fetchLivescores,
  fetchFixtureInfo,
  normaliseRole,
};
