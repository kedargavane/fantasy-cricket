'use strict';

const express = require('express');
const { calculateFantasyPoints, DEFAULT_SCORING_CONFIG } = require('../engines/scoringEngine');
const { getDb }       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/matches ──────────────────────────────────────────────────────────
// List all matches for the user's season(s)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { seasonId } = req.query;

  // Verify user is member of requested season
  if (seasonId) {
    const member = db.prepare(
      'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
    ).get(seasonId, req.user.id);

    if (!member) return res.status(403).json({ error: 'Not a member of this season' });
  }

  const matches = db.prepare(`
    SELECT
      m.id, m.external_match_id, m.team_a, m.team_b, m.venue,
      m.match_type, m.status, m.start_time, m.last_synced, m.live_score,
      m.toss_info, m.venue_info,
      mc.entry_units,
      -- Has this user submitted a team?
      CASE WHEN ut.id IS NOT NULL THEN 1 ELSE 0 END as has_team,
      ut.total_fantasy_points,
      ut.match_rank,
      ut.units_won
    FROM matches m
    LEFT JOIN match_config mc ON mc.match_id = m.id
    LEFT JOIN user_teams ut ON ut.match_id = m.id AND ut.user_id = ?
    WHERE m.season_id = ?
    ORDER BY m.start_time ASC
  `).all(req.user.id, seasonId);

  return res.json({ matches });
});

// ── GET /api/matches/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare(`
    SELECT m.*, mc.entry_units
    FROM matches m
    LEFT JOIN match_config mc ON mc.match_id = m.id
    WHERE m.id = ?
  `).get(matchId);

  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Verify user is in this match's season
  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);

  if (!member) return res.status(403).json({ error: 'Access denied' });

  // Prize pool info
  const prizePool = db.prepare(
    'SELECT * FROM match_prize_pools WHERE match_id = ?'
  ).get(matchId);

  // Participation count
  const participantCount = db.prepare(
    'SELECT COUNT(*) as count FROM user_teams WHERE match_id = ?'
  ).get(matchId).count;

  return res.json({ match, prizePool, participantCount });
});

// ── GET /api/matches/:id/squad ────────────────────────────────────────────────
// Full squad with playing XI status
router.get('/:id/squad', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT season_id FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const seasonId = match.season_id;

  const squad = db.prepare(`
    SELECT
      p.id, p.name, p.team, p.role, p.external_player_id,
      ms.is_playing_xi, ms.is_substitute,
      COALESCE(SUM(pms.fantasy_points), 0) as season_pts,
      CASE WHEN COUNT(pms.match_id) > 0
        THEN ROUND(CAST(SUM(pms.fantasy_points) AS REAL) / COUNT(pms.match_id))
        ELSE 0 END as season_avg
    FROM match_squads ms
    JOIN players p ON p.id = ms.player_id
    LEFT JOIN player_match_stats pms ON pms.player_id = p.id
      AND pms.match_id IN (
        SELECT id FROM matches WHERE season_id = ? AND status = 'completed'
      )
    WHERE ms.match_id = ?
    GROUP BY p.id
    ORDER BY p.team, ms.is_playing_xi DESC, ms.is_substitute ASC, p.name
  `).all(seasonId, matchId);

  return res.json({ squad });
});

// ── GET /api/matches/:id/scores ───────────────────────────────────────────────
// Live / final player scores for a match
router.get('/:id/scores', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const scores = db.prepare(`
    SELECT
      p.id as player_id, p.name, p.team, p.role,
      pms.runs, pms.balls_faced, pms.fours, pms.sixes, pms.dismissal_type,
      pms.overs_bowled, pms.wickets, pms.runs_conceded, pms.maidens,
      pms.catches, pms.stumpings, pms.run_outs,
      pms.fantasy_points,
      pms.bowler_name, pms.catcher_name, pms.runout_name, pms.batting_team_id, pms.match_team,
      pms.scoreboard, pms.sort_order, pms.is_active,
      ms.is_playing_xi,
      pms.updated_at
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    LEFT JOIN match_squads ms ON ms.match_id = pms.match_id AND ms.player_id = pms.player_id
    WHERE pms.match_id = ?
    ORDER BY pms.scoreboard ASC, pms.sort_order ASC
  `).all(matchId);

  // Add scoring breakdown to each player
  const scoresWithBreakdown = scores.map(s => {
    let breakdown = {};
    try { ({ breakdown } = calculateFantasyPoints({
      isPlayingXi:   s.is_playing_xi,
      runs:          s.runs,
      ballsFaced:    s.balls_faced,
      fours:         s.fours,
      sixes:         s.sixes,
      dismissalType: s.dismissal_type,
      oversBowled:   s.overs_bowled,
      wickets:       s.wickets,
      runsConceded:  s.runs_conceded,
      maidens:       s.maidens,
      catches:       s.catches,
      stumpings:     s.stumpings,
      runOuts:       s.run_outs,
    }, 'normal', DEFAULT_SCORING_CONFIG)); } catch(e) { breakdown = {}; }
    return { ...s, breakdown };
  });

  return res.json({ match, scores: scoresWithBreakdown, lastSynced: match.last_synced });
});

// ── GET /api/matches/:id/leaderboard ─────────────────────────────────────────
// Match leaderboard — all user teams ranked by fantasy points
router.get('/:id/leaderboard', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const leaderboard = db.prepare(`
    SELECT
      ut.id as user_team_id,
      u.id  as user_id,
      u.name,
      ut.total_fantasy_points,
      ut.match_rank,
      ut.units_won,
      COALESCE(mc.entry_units, 300) as entry_units,
      ut.total_fantasy_points - COALESCE(mc.entry_units, 300) as net_units,
      -- captain and VC names
      cp.name  as captain_name,
      vcp.name as vc_name
    FROM user_teams ut
    JOIN users u   ON u.id  = ut.user_id
    JOIN players cp  ON cp.id = COALESCE(ut.resolved_captain_id, ut.captain_id)
    JOIN players vcp ON vcp.id = COALESCE(ut.resolved_vice_captain_id, ut.vice_captain_id)
    LEFT JOIN match_config mc ON mc.match_id = ut.match_id
    WHERE ut.match_id = ?
    ORDER BY ut.total_fantasy_points DESC
  `).all(matchId);

  // Attach prize distribution if finalised
  const prizes = db.prepare(`
    SELECT pd.user_team_id, pd.rank, pd.gross_units, pd.net_units
    FROM prize_distributions pd
    JOIN match_prize_pools mpp ON mpp.id = pd.match_prize_pool_id
    WHERE mpp.match_id = ?
  `).all(matchId);

  const prizeMap = {};
  for (const p of prizes) prizeMap[p.user_team_id] = p;

  const result = leaderboard.map((entry, idx) => ({
    ...entry,
    liveRank: idx + 1,
    prize: prizeMap[entry.user_team_id] || null,
  }));

  return res.json({ matchId, match, leaderboard: result });
});

// ── GET /api/matches/:id/rank-snapshots ──────────────────────────────────────
router.get('/:id/rank-snapshots', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.id, 10);

  const snapshots = db.prepare(`
    SELECT rs.over, rs.total_pts, rs.rank,
           u.name as user_name, u.id as user_id
    FROM rank_snapshots rs
    JOIN user_teams ut ON ut.id = rs.user_team_id
    JOIN users u ON u.id = ut.user_id
    WHERE rs.match_id = ?
    ORDER BY rs.over ASC, rs.rank ASC
  `).all(matchId);

  // Group by user for chart series
  const series = {};
  for (const s of snapshots) {
    if (!series[s.user_id]) series[s.user_id] = { name: s.user_name, data: [] };
    series[s.user_id].data.push({ over: s.over, rank: s.rank, pts: s.total_pts });
  }

  return res.json({ matchId, series: Object.values(series) });
});

// ── GET /api/matches/:id/venue-history ───────────────────────────────────────
// Returns last 5 completed matches at the same venue this season
router.get('/:id/venue-history', requireAuth, (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const venueKey = match.venue_info || match.venue;
  if (!venueKey) return res.json({ venue: null, history: [] });

  // Match by stadium name (first segment before comma)
  const stadiumName = venueKey.split(',')[0].trim();

  const history = db.prepare(`
    SELECT id, team_a, team_b, start_time, venue_info, innings1_score, innings2_score
    FROM matches
    WHERE season_id = ?
      AND status = 'completed'
      AND id != ?
      AND venue_info LIKE ?
    ORDER BY start_time DESC
    LIMIT 5
  `).all(match.season_id, matchId, `%${stadiumName}%`);

  // Compute avg, high, low from stored innings scores
  const allRuns = history.flatMap(m => {
    const runs = [];
    if (m.innings1_score) { const r = parseInt(m.innings1_score); if (!isNaN(r)) runs.push(r); }
    if (m.innings2_score) { const r = parseInt(m.innings2_score); if (!isNaN(r)) runs.push(r); }
    return runs;
  });

  const avg  = allRuns.length ? Math.round(allRuns.reduce((a,b) => a+b,0) / allRuns.length) : null;
  const high = allRuns.length ? Math.max(...allRuns) : null;
  const low  = allRuns.length ? Math.min(...allRuns) : null;

  return res.json({
    venue: stadiumName,
    venue_info: match.venue_info,
    avg, high, low,
    history,
  });
});

// ── GET /api/matches/player/:playerId/season/:seasonId/stats ─────────────────
router.get('/player/:playerId/season/:seasonId/stats', requireAuth, (req, res) => {
  const db       = getDb();
  const playerId = parseInt(req.params.playerId, 10);
  const seasonId = parseInt(req.params.seasonId, 10);

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const player = db.prepare('SELECT id, name, team, role FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const matches = db.prepare(`
    SELECT
      pms.fantasy_points, pms.runs, pms.balls_faced, pms.fours, pms.sixes,
      pms.overs_bowled, pms.wickets, pms.runs_conceded, pms.maidens,
      pms.catches, pms.stumpings, pms.run_outs,
      m.id as match_id, m.team_a, m.team_b, m.start_time
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE pms.player_id = ? AND m.season_id = ? AND m.status = 'completed'
    ORDER BY m.start_time DESC
    LIMIT 5
  `).all(playerId, seasonId);

  const allMatches = db.prepare(`
    SELECT COUNT(*) as total, SUM(pms.fantasy_points) as total_pts
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE pms.player_id = ? AND m.season_id = ? AND m.status = 'completed'
  `).get(playerId, seasonId);

  const totalMatches = allMatches?.total || 0;
  const totalPts     = allMatches?.total_pts || 0;
  const avgPts       = totalMatches > 0 ? Math.round(totalPts / totalMatches) : 0;
  const bestPts      = matches.length > 0 ? Math.max(...matches.map(m => m.fantasy_points || 0)) : 0;

  return res.json({ player, totalMatches, totalPts, avgPts, bestPts, last5: matches });
});

// ── GET /api/matches/:id/commentary ──────────────────────────────────────────
// Returns all generated commentary stages for a match
router.get('/:id/commentary', requireAuth, (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);

  const match = db.prepare('SELECT season_id FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const commentary = db.prepare(
    'SELECT * FROM match_commentary WHERE match_id = ? ORDER BY id ASC'
  ).all(matchId);

  return res.json({ commentary: commentary.map(c => ({
    ...c,
    bullets: JSON.parse(c.bullets),
  }))});
});

// ── POST /api/admin/matches/:id/generate-commentary ──────────────────────────
// Generates commentary for a given stage using Claude API
router.post('/:id/generate-commentary', requireAuth, async (req, res) => {
  const db = getDb();
  const matchId = parseInt(req.params.id, 10);
  const { stage, overs } = req.body;

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

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

  // Get top scorers
  const topScorers = db.prepare(`
    SELECT p.name, pms.fantasy_points, pms.runs, pms.wickets, pms.catches
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    WHERE pms.match_id = ?
    ORDER BY pms.fantasy_points DESC
    LIMIT 8
  `).all(matchId);

  // Get team compositions (who picked whom as captain)
  const teamPlayers = db.prepare(`
    SELECT u.name as team_name, p.name as player_name, utp.is_backup,
      CASE WHEN ut.resolved_captain_id = p.id THEN 'captain'
           WHEN ut.resolved_vice_captain_id = p.id THEN 'vice_captain'
           ELSE 'normal' END as role
    FROM user_teams ut
    JOIN user_team_players utp ON utp.user_team_id = ut.id
    JOIN players p ON p.id = utp.player_id
    JOIN users u ON u.id = ut.user_id
    WHERE ut.match_id = ?
  `).all(matchId);

  const stageLabels = {
    locked: 'Teams just locked — match about to start',
    pp1: 'After 10 overs of 1st innings',
    inn1: 'After 1st innings complete',
    pp2: 'After 10 overs of 2nd innings (chase)',
    final: 'Match complete — final result',
  };

  const prompt = `You are writing punchy, funny fantasy cricket banter for a private league of friends called "Gyarah Sapne". 
Match: ${match.team_a} vs ${match.team_b}
Stage: ${stageLabels[stage] || stage} (${overs} overs)

Current leaderboard:
${leaderboard.map((e, i) => `#${i+1} ${e.name} — ${e.total_fantasy_points}pts | C:${e.captain_name} VC:${e.vc_name} | units:${e.units_won}`).join('\n')}

Top fantasy scorers so far:
${topScorers.map(p => `${p.name}: ${p.fantasy_points}pts (${p.runs}r ${p.wickets}w ${p.catches}ct)`).join('\n')}

Write banter commentary for this stage. Be specific, funny, call out bold/bad captain choices, mention players by name. Keep it like a WhatsApp message from a knowledgeable friend, not a formal sports report.

Respond ONLY with valid JSON in this exact format, no markdown:
{
  "headline": "One punchy sentence (max 10 words, can be funny/sarcastic)",
  "body": "2-3 sentences of commentary calling out specific teams and players",
  "bullets": [
    {"icon": "emoji", "text": "specific observation about a team or player"},
    {"icon": "emoji", "text": "specific observation"},
    {"icon": "emoji", "text": "specific observation"},
    {"icon": "emoji", "text": "specific observation"}
  ]
}`;

  try {
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
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    // Store in DB (upsert)
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

    return res.json({ ok: true, stage, commentary: parsed });
  } catch (e) {
    console.error('[commentary] error:', e.message);
    return res.status(500).json({ error: 'Failed to generate commentary', detail: e.message });
  }
});

module.exports = router;
