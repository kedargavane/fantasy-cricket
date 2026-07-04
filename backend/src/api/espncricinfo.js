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

  // Score from competitors
  const score = (comp?.competitors || []).map(c => ({
    teamName: c.team?.displayName,
    r: parseInt((c.score||'0').split('/')[0]) || 0,
    w: parseInt((c.score||'0').split('/')[1]) || 10,
    o: 0,
    inning: c.team?.displayName + ' Inning 1'
  }));

  // Build innings from rosters
  const innings = [];

  for (const roster of (data.rosters || [])) {
    const teamName = roster.team?.displayName;
    const batting = [];
    const bowling = [];
    const catching = {};

    for (const player of (roster.roster || [])) {
      const name = player.athlete?.displayName;
      const espnId = player.athlete?.id;

      // Find our CricketData UUID by name match (will be resolved in syncService)
      const ls = player.linescores?.[0]?.linescores?.[0];
      if (!ls) continue;

      const stats = ls.statistics;
      const batted = getStat(stats, 'batted');
      const bowled = player.linescores?.[0]?.linescores?.find(l =>
        l.statistics?.categories?.some(c => c.stats?.some(s => s.name === 'oversBowled'))
      );

      if (batted) {
        const outDetails = stats.batting?.outDetails;
        const dismissalCard = getStat(stats, 'dismissalCard') ||
          stats.categories?.[0]?.stats?.find(s => s.name === 'dismissalCard')?.displayValue;

        const fielders = outDetails?.fielders || [];
        const catcher = fielders[0]?.athlete;
        const bowlerInfo = outDetails?.bowler;

        batting.push({
          batsman: { id: espnId, name, espnId },
          r: getStat(stats, 'runs'),
          b: getStat(stats, 'ballsFaced'),
          '4s': getStat(stats, 'fours'),
          '6s': getStat(stats, 'sixes'),
          sr: getStat(stats, 'strikeRate'),
          dismissal: normaliseDismissal(dismissalCard),
          'dismissal-text': outDetails?.shortText || '',
          bowler: bowlerInfo ? {
            id: bowlerInfo.id,
            name: bowlerInfo.displayName
          } : null,
          catcher: catcher ? {
            id: catcher.id,
            name: catcher.displayName,
            isKeeper: fielders[0]?.isKeeper === 1
          } : null,
          battingPosition: getStat(stats, 'battingPosition')
        });

        // Build catching summary
        if (catcher) {
          const key = catcher.id;
          if (!catching[key]) catching[key] = {
            catcher: { id: catcher.id, name: catcher.displayName },
            catch: 0, stumped: 0, runout: 0
          };
          const d = normaliseDismissal(dismissalCard);
          if (d === 'stumped') catching[key].stumped++;
          else if (d === 'caught') catching[key].catch++;
          else if (d === 'runout') catching[key].runout++;
        }
      }
    }

    // Get bowling from leaders or opposite team roster
    // We'll get bowling from the other team's roster
    innings.push({
      inning: teamName + ' Inning 1',
      batting: batting.sort((a,b) => a.battingPosition - b.battingPosition),
      bowling: [], // filled below
      catching: Object.values(catching)
    });
  }

  // Get bowling figures from leaders
  for (const leader of (data.leaders || [])) {
    const teamName = leader.team?.displayName;
    // Find opposite innings
    const inn = innings.find(i => !i.inning.includes(teamName));
    if (!inn) continue;

    const wicketLeaders = leader.linescores?.[0]?.leaders?.find(l => l.name === 'wickets');
    // This only gives top bowlers, not all — we'll need full bowling from roster
  }

  // Better: get bowling from rosters using bowling stats
  for (let ri = 0; ri < (data.rosters||[]).length; ri++) {
    const roster = data.rosters[ri];
    const oppositeInn = innings[1 - ri]; // opposite innings gets this team's bowling
    if (!oppositeInn) continue;

    const bowling = [];
    for (const player of roster.roster || []) {
      const name = player.athlete?.displayName;
      const espnId = player.athlete?.id;

      // Check all linescores periods for bowling stats
      for (const period of (player.linescores || [])) {
        for (const ls of (period.linescores || [])) {
          const hasBowling = ls.statistics?.categories?.some(c =>
            c.stats?.some(s => s.name === 'oversBowled')
          );
          if (hasBowling) {
            const stats = ls.statistics;
            const getBS = (n) => {
              for (const cat of stats.categories||[]) {
                const s = cat.stats?.find(s => s.name === n);
                if (s) return s.value;
              }
              return 0;
            };
            bowling.push({
              bowler: { id: espnId, name, espnId },
              o: getBS('oversBowled'),
              m: getBS('maidens'),
              r: getBS('runsConceded'),
              w: getBS('wickets'),
              nb: getBS('noBalls'),
              wd: getBS('wides'),
              eco: getBS('economy')
            });
          }
        }
      }
    }
    if (bowling.length > 0) oppositeInn.bowling = bowling;
  }

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
    innings
  };
}

module.exports = { fetchESPNScorecard };
