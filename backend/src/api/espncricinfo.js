const axios = require('axios');

const ESPN_EVENT_ID = '1496575'; // England vs India 2nd T20I
const BASE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/23810/summary';

async function fetchESPNScorecard(eventId) {
  const res = await axios.get(BASE_URL, {
    params: { contentorigin: 'espn', event: eventId, lang: 'en', region: 'in' },
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });

  const data = res.data;
  const comp = data.header?.competitions?.[0];
  const matchStatus = comp?.status?.type?.description; // 'Live', 'Final' etc
  const matchEnded = comp?.status?.type?.completed === true;
  const matchStarted = comp?.status?.type?.id !== '1'; // not pre-match

  // Get score
  const score = comp?.competitors?.map(c => ({
    teamName: c.team?.displayName,
    r: parseInt(c.score?.split('/')[0]) || 0,
    w: parseInt(c.score?.split('/')[1]) || 0,
    inning: c.team?.displayName + ' Inning 1'
  })) || [];

  // Get matchcards (innings data)
  const matchcards = data.matchcards || [];
  const innings = matchcards.map((mc, i) => {
    const batting = (mc.batsmen || []).map(b => ({
      batsman: {
        id: b.athlete?.id,
        name: b.athlete?.displayName
      },
      r: b.runs || 0,
      b: b.ballsFaced || 0,
      '4s': b.fours || 0,
      '6s': b.sixes || 0,
      sr: b.strikeRate || 0,
      dismissal: normaliseDismissal(b.dismissalText?.short),
      'dismissal-text': b.dismissalText?.long || ''
    }));

    const bowling = (mc.bowlers || []).map(b => ({
      bowler: {
        id: b.athlete?.id,
        name: b.athlete?.displayName
      },
      o: parseFloat(b.overs) || 0,
      m: b.maidens || 0,
      r: b.runs || 0,
      w: b.wickets || 0,
      nb: b.noBalls || 0,
      wd: b.wides || 0,
      eco: parseFloat(b.economy) || 0
    }));

    return { inning: mc.title || 'Inning ' + (i+1), batting, bowling, catching: [] };
  });

  return {
    matchInfo: {
      matchStarted,
      matchEnded,
      status: matchStatus,
      trulyFinished: matchEnded,
      score,
      tossInfo: null,
      venueInfo: comp?.venue?.fullName || null
    },
    innings,
    eventId
  };
}

function normaliseDismissal(text) {
  if (!text) return 'notout';
  const t = text.toLowerCase();
  if (t.includes('not out') || t.includes('batting')) return 'notout';
  if (t.includes('caught')) return 'caught';
  if (t.includes('bowled')) return 'bowled';
  if (t.includes('lbw')) return 'lbw';
  if (t.includes('run out')) return 'runout';
  if (t.includes('stumped')) return 'stumped';
  return 'caught';
}

module.exports = { fetchESPNScorecard };
