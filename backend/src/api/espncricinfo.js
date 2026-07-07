'use strict';
const axios = require('axios');

const BASE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/23810/summary';

function getStat(stats, name) {
  for (const cat of stats.categories || []) {
    const s = cat.stats?.find(s => s.name === name);
    if (s) return s.value;
  }
  return 0;
}

function hasStat(stats, name) {
  return (stats.categories || []).some(c => c.stats?.some(s => s.name === name));
}

// Every player has both a batting-period and a bowling-period linescore
// regardless of role (all zeros if they didn't do it) — and which period
// comes first in the array varies by team. Identify each by the stat names
// it carries ('batted' / 'bowled') instead of assuming a fixed index.
function findPeriodStats(player, statName) {
  for (const period of (player.linescores || [])) {
    for (const ls of (period.linescores || [])) {
      if (hasStat(ls.statistics, statName)) return ls.statistics;
    }
  }
  return null;
}

function normaliseDismissal(card) {
  if (!card) return 'notout';
  const c = card.toLowerCase();
  if (c === 'c') return 'caught';
  if (c === 'b') return 'bowled';
  if (c === 'lbw') return 'lbw';
  if (c === 'ro') return 'runout';
  if (c === 'st') return 'stumped';
  if (c === 'c&b' || c === 'cb') return 'caught';
  if (c === 'hw') return 'hitwicket';
  return 'notout';
}

async function fetchESPNScorecard(eventId) {
  const res = await axios.get(BASE_URL, {
    params: { contentorigin: 'espn', event: eventId, lang: 'en', region: 'in' },
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });

  const data = res.data;
  const comp = data.header?.competitions?.[0];
  const matchEnded = comp?.status?.type?.completed === true;
  const matchStarted = comp?.status?.type?.id !== '1';
  const statusDesc = comp?.status?.type?.description || '';

  // Build one innings skeleton per roster/team up front, so a bowler's
  // figures (credited to the batting team's innings) always have somewhere
  // to land regardless of processing order.
  const innings = (data.rosters || []).map(roster => ({
    inning: roster.team?.displayName + ' Inning 1',
    batting: [],
    bowling: [],
    catching: {},
  }));

  for (let ri = 0; ri < (data.rosters || []).length; ri++) {
    const roster        = data.rosters[ri];
    const ownInning      = innings[ri];
    const opposingInning = innings[1 - ri]; // this team's bowling/fielding lands in the batting team's innings
    if (!opposingInning) continue;

    for (const player of (roster.roster || [])) {
      const name = player.athlete?.displayName;
      if (!name) continue;

      const battingStats = findPeriodStats(player, 'batted');
      const bowlingStats = findPeriodStats(player, 'bowled');

      if (battingStats && getStat(battingStats, 'batted') === 1) {
        const outDetails = battingStats.batting?.outDetails;
        const dismissalCard = getStat(battingStats, 'dismissalCard') || outDetails?.dismissalCard;

        const fielders = outDetails?.fielders || [];
        const catcher = fielders[0]?.athlete;
        const bowlerInfo = outDetails?.bowler;

        ownInning.batting.push({
          // Don't use ESPN's numeric athlete id as externalPlayerId — it
          // isn't the CricketData UUID our players are keyed on. Name-only
          // lets syncService match this to the existing player instead.
          batsman: { id: null, name },
          r: getStat(battingStats, 'runs'),
          b: getStat(battingStats, 'ballsFaced'),
          '4s': getStat(battingStats, 'fours'),
          '6s': getStat(battingStats, 'sixes'),
          sr: getStat(battingStats, 'strikeRate'),
          dismissal: normaliseDismissal(dismissalCard),
          'dismissal-text': outDetails?.shortText || '',
          bowler: bowlerInfo ? { id: null, name: bowlerInfo.displayName } : null,
          catcher: catcher ? {
            id: null,
            name: catcher.displayName,
            isKeeper: fielders[0]?.isKeeper === 1
          } : null,
          battingPosition: getStat(battingStats, 'battingPosition')
        });

        // Build catching summary, keyed by fielder name (no ESPN id). This
        // belongs in ownInning (same object as the dismissed batsman's entry)
        // — cricketdata.js derives the fielding team from that innings' own
        // label, not from the fielder's actual team.
        if (catcher) {
          const key = catcher.displayName;
          if (!ownInning.catching[key]) ownInning.catching[key] = {
            catcher: { id: null, name: catcher.displayName },
            catch: 0, stumped: 0, runout: 0
          };
          const d = normaliseDismissal(dismissalCard);
          if (d === 'stumped') ownInning.catching[key].stumped++;
          else if (d === 'caught') ownInning.catching[key].catch++;
          else if (d === 'runout') ownInning.catching[key].runout++;
        }
      }

      // ESPN's bowling stat names differ from what we assumed: 'overs' (not
      // oversBowled), 'conceded' (not runsConceded), 'economyRate' (not
      // economy), 'noballs' (not noBalls). 'bowled' is the did-they-bowl flag,
      // mirroring 'batted' for the batting period.
      if (bowlingStats && getStat(bowlingStats, 'bowled') === 1) {
        opposingInning.bowling.push({
          bowler: { id: null, name },
          o: getStat(bowlingStats, 'overs'),
          m: getStat(bowlingStats, 'maidens'),
          r: getStat(bowlingStats, 'conceded'),
          w: getStat(bowlingStats, 'wickets'),
          nb: getStat(bowlingStats, 'noballs'),
          wd: getStat(bowlingStats, 'wides'),
          eco: getStat(bowlingStats, 'economyRate')
        });
      }
    }
  }

  const finalInnings = innings.map(inn => ({
    inning: inn.inning,
    batting: inn.batting.sort((a, b) => a.battingPosition - b.battingPosition),
    bowling: inn.bowling,
    catching: Object.values(inn.catching),
  }));

  // Overs faced by a team = overs bowled against them, which is the sum of
  // the OPPOSING bowlers' figures recorded in that team's own innings object
  // (see the ownInning/opposingInning split above).
  const oversFacedByTeam = {};
  (data.rosters || []).forEach((roster, ri) => {
    const teamName = roster.team?.displayName;
    if (teamName) oversFacedByTeam[teamName] = (finalInnings[ri]?.bowling || [])
      .reduce((sum, b) => sum + (b.o || 0), 0);
  });

  // ESPN's score string embeds live overs for the team currently batting,
  // e.g. "52/3 (4.5/20 ov, target 191)" — but omits it once that innings is
  // done (just "190/7"). Parse it when present; otherwise fall back to the
  // bowling-sum above (still correct for a completed innings).
  function parseOvers(scoreStr) {
    const m = (scoreStr || '').match(/\(([\d.]+)\s*\/\s*\d+\s*ov/);
    return m ? parseFloat(m[1]) : null;
  }

  // `|| fallback` treats a genuinely-parsed 0 as falsy (e.g. "0/0 (0.4/20 ov)"
  // — 0 wickets down, in progress — was showing as "10", i.e. all out).
  // Only fall back when the parse actually failed (NaN), such as a team
  // that hasn't batted yet (empty score string).
  function parseIntOr(str, fallback) {
    const n = parseInt(str, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  const score = (comp?.competitors || []).map(c => {
    const teamName = c.team?.displayName;
    const overs = parseOvers(c.score) ?? (oversFacedByTeam[teamName] || 0);
    const parts = (c.score || '').split('/');
    return {
      teamName,
      r: parseIntOr(parts[0], 0),
      w: parseIntOr(parts[1], 0),
      o: overs,
      inning: teamName + ' Inning 1'
    };
  });

  return {
    matchInfo: {
      matchStarted,
      matchEnded,
      trulyFinished: matchEnded,
      status: statusDesc,
      score,
      tossInfo: null,
      venueInfo: null,
      matchWinner: null
    },
    innings: finalInnings
  };
}

// Given one known ESPN event ID, find every other match in the same series.
// ESPN's event summary reveals its own series/league id (header.leagues.id)
// and season year — querying that league's scoreboard with dates=<year>
// returns the whole series in one call. There's no cross-league search in
// ESPN's API, so this only discovers siblings of an event we already know,
// not brand-new series we've never linked anything from.
async function discoverSeriesEvents(seedEventId) {
  const res = await axios.get(BASE_URL, {
    params: { contentorigin: 'espn', event: seedEventId, lang: 'en', region: 'in' },
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });

  const leagueId    = res.data.header?.league?.id;
  const seasonYear   = res.data.header?.season?.year || new Date().getFullYear();
  if (!leagueId) throw new Error('Could not determine ESPN series id from seed event');

  const scoreRes = await axios.get(
    `https://site.api.espn.com/apis/site/v2/sports/cricket/${leagueId}/scoreboard`,
    {
      params: { dates: seasonYear },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    }
  );

  return (scoreRes.data.events || []).map(e => {
    const [teamA, teamB] = (e.name || '').split(' v ').map(s => s && s.trim());
    return { eventId: e.id, name: e.name, teamA, teamB, date: e.date };
  });
}

module.exports = { fetchESPNScorecard, discoverSeriesEvents };
