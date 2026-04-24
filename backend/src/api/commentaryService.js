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

  const prompt = `You are writing punchy, funny fantasy cricket banter for a private league of friends called "Gyarah Sapne".
Match: ${match.team_a} vs ${match.team_b}
Stage: ${STAGE_LABELS[stage] || stage} (${overs} overs)

Current leaderboard:
${leaderboard.map((e, i) => `#${i+1} ${e.name} — ${e.total_fantasy_points}pts | C:${e.captain_name} VC:${e.vc_name} | units:${e.units_won || 0}`).join('\n')}

Top fantasy scorers so far:
${topScorers.length > 0 ? topScorers.map(p => `${p.name}: ${p.fantasy_points}pts (${p.runs}r ${p.wickets}w ${p.catches}ct)`).join('\n') : 'Match not started yet'}

Write banter commentary for this stage. Be specific, funny, call out bold/bad captain choices, mention players and team names. Keep it like a WhatsApp message from a knowledgeable friend, not a formal report. If match hasn't started yet, focus on team compositions and captain choices.

Respond ONLY with valid JSON, no markdown backticks:
{
  "headline": "One punchy sentence, max 10 words, can be funny or sarcastic",
  "body": "2-3 sentences calling out specific teams and players",
  "bullets": [
    {"icon": "emoji", "text": "specific observation about a team or player"},
    {"icon": "emoji", "text": "specific observation"},
    {"icon": "emoji", "text": "specific observation"},
    {"icon": "emoji", "text": "specific observation"}
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
      model: 'claude-sonnet-4-20250514',
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
