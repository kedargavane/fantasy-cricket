'use strict';

const { getDb } = require('../db/database');

const STAGE_LABELS = {
  locked: 'Teams just locked — match about to start',
  pp1:    'After 10 overs of 1st innings',
  inn1:   'After 1st innings complete',
  pp2:    'After 10 overs of 2nd innings (chase)',
  final:  'Match complete — final result',
};

async function generateCommentary(matchId, stage, overs) {
  const db = getDb();

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) throw new Error(`Match ${matchId} not found`);

  // Check if already generated
  const existing = db.prepare(
    'SELECT id FROM match_commentary WHERE match_id = ? AND stage = ?'
  ).get(matchId, stage);
  if (existing) {
    console.log(`[commentary] Stage ${stage} already exists for match ${matchId} — skipping`);
    return null;
  }

  // Get leaderboard data
  const leaderboard = db.prepare(`
    SELECT u.name, ut.total_fantasy_points, ut.match_rank,
      cp.name as captain_name, vcp.name as vc_name,
      ut.units_won
    FROM user_teams ut
    JOIN users u ON u.id = ut.user_id
    LEFT JOIN players cp  ON cp.id = ut.resolved_captain_id
    LEFT JOIN players vcp ON vcp.id = ut.resolved_vice_captain_id
    WHERE ut.match_id = ?
    ORDER BY ut.total_fantasy_points DESC
  `).all(matchId);

  if (leaderboard.length === 0) {
    console.log(`[commentary] No teams found for match ${matchId} — skipping`);
    return null;
  }

  // Get top scorers
  const topScorers = db.prepare(`
    SELECT p.name, pms.fantasy_points, pms.runs, pms.wickets, pms.catches
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    WHERE pms.match_id = ?
    ORDER BY pms.fantasy_points DESC
    LIMIT 8
  `).all(matchId);

  // Captain ownership — who picked whom as captain
  const captainCounts = {};
  for (const e of leaderboard) {
    if (e.captain_name) {
      captainCounts[e.captain_name] = (captainCounts[e.captain_name] || []);
      captainCounts[e.captain_name].push(e.name);
    }
  }
  const captainSummary = Object.entries(captainCounts)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cap, teams]) => `${cap} (${teams.length} teams: ${teams.join(', ')})`)
    .join('\n');

  // Points gap between 1st and last
  const ptsGap = leaderboard.length > 1
    ? leaderboard[0].total_fantasy_points - leaderboard[leaderboard.length - 1].total_fantasy_points
    : 0;

  const prompt = `You are the designated WhatsApp group menace for a private fantasy cricket league called "Gyarah Sapne". Your commentary is read by everyone in the group during the match.

Your personality: equal parts Harsha Bhogle, r/cricket shitposter, and that one friend who always says "I told you so". You reference cricket memes, IPL drama, and corporate jargon ironically. You are never neutral.

CRITICAL RULES — FACTS ONLY:
- ONLY mention players, teams and scores that appear in the data below
- NEVER invent scores, player performances or outcomes not in the data
- NEVER assume how many teams are playing — use exactly what's in the leaderboard
- NEVER predict what will happen — only comment on what HAS happened
- If match hasn't started, only comment on team compositions and captain choices visible in the data
- If a stat isn't in the data, don't mention it

Match: ${match.team_a} vs ${match.team_b}
Stage: ${STAGE_LABELS[stage] || stage} (${overs} overs)

Leaderboard (${leaderboard.length} teams):
${leaderboard.map((e, i) => `#${i+1} ${e.name} — ${e.total_fantasy_points}pts | C:${e.captain_name} VC:${e.vc_name} | units:${e.units_won || 0}`).join('\n')}

Captain ownership:
${captainSummary || 'No captains assigned yet'}

Points gap (1st to last): ${ptsGap} pts

Top fantasy scorers so far:
${topScorers.length > 0 ? topScorers.map(p => `${p.name}: ${p.fantasy_points}pts (${p.runs}r ${p.wickets}w ${p.catches}ct)`).join('\n') : 'No scores yet — match not started'}

STYLE RULES:
- Headline feels like a viral meme caption or breaking news chyron. Max 10 words.
- Body is 2-3 sentences. Mix cricket insight with humour. Use only facts from the data above.
- Use corporate jargon ironically — "synergies", "pivot", "leverage", "circle back"
- Use cricket slang naturally — golden duck, corridor of uncertainty, hit the deck etc
- Mock herd mentality when multiple teams share the same captain
- Hype contrarian picks that are paying off
- Roast bad captain choices with no mercy — but only if data shows they flopped
- Reference memes when relevant — "main character energy", "not the hero we deserved" etc
- At least one bullet must roast or hype a specific team by name
- Never say "remains to be seen" or "time will tell"

Respond ONLY with valid JSON, no markdown backticks:
{
  "headline": "meme-worthy caption, max 10 words",
  "body": "2-3 sentences, facts only, with personality",
  "bullets": [
    {"icon": "emoji", "text": "specific fact-based roast or hype"},
    {"icon": "emoji", "text": "specific observation with personality"},
    {"icon": "emoji", "text": "corporate jargon or meme reference tied to real data"},
    {"icon": "emoji", "text": "cricket insight with attitude"}
  ]
}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const text = data.content?.[0]?.text || '';
  const parsed = JSON.parse(text.trim());

  // Store in DB
  db.prepare(`
    INSERT INTO match_commentary (match_id, stage, headline, body, bullets, overs)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, stage) DO UPDATE SET
      headline = excluded.headline,
      body = excluded.body,
      bullets = excluded.bullets,
      overs = excluded.overs,
      generated_at = datetime('now')
  `).run(matchId, stage, parsed.headline, parsed.body, JSON.stringify(parsed.bullets), overs);

  console.log(`[commentary] Generated ${stage} for match ${matchId}`);
  return parsed;
}

module.exports = { generateCommentary };
