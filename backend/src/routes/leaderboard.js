'use strict';

const express = require('express');
const { getDb }       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/leaderboard/season/:seasonId ─────────────────────────────────────
router.get('/season/:seasonId', requireAuth, (req, res) => {
  const db       = getDb();
  const seasonId = parseInt(req.params.seasonId, 10);

  // Verify membership
  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member of this season' });

  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  // Total matches played (completed) in season
  const totalCompleted = db.prepare(
    "SELECT COUNT(*) as count FROM matches WHERE season_id = ? AND status = 'completed'"
  ).get(seasonId).count;

  const minMatchesRequired = Math.ceil(totalCompleted * 0.25); // 25% threshold

  const leaderboard = db.prepare(`
    SELECT
      sl.*,
      u.name,
      -- Season score = net_units / matches_played (avg profit per match)
      CASE
        WHEN sl.matches_played > 0
        THEN ROUND(CAST(sl.net_units AS REAL) / sl.matches_played, 2)
        ELSE 0
      END as season_score,
      CASE
        WHEN sl.matches_played >= ? THEN 1
        ELSE 0
      END as is_eligible
    FROM season_leaderboard sl
    JOIN users u ON u.id = sl.user_id
    WHERE sl.season_id = ?
    ORDER BY
      is_eligible DESC,
      season_score DESC,
      sl.net_units DESC,
      sl.top_finishes DESC
  `).all(minMatchesRequired, seasonId);

  // Re-rank only eligible players
  let rank = 1;
  const result = leaderboard.map((entry, idx) => {
    if (entry.is_eligible) {
      if (idx > 0 && leaderboard[idx - 1].is_eligible &&
          leaderboard[idx - 1].season_score === entry.season_score) {
        entry.display_rank = leaderboard[idx - 1].display_rank;
      } else {
        entry.display_rank = rank;
      }
      rank++;
    } else {
      entry.display_rank = null;
    }
    return entry;
  });

  return res.json({
    season,
    leaderboard: result,
    totalCompleted,
    minMatchesRequired,
  });
});

// ── GET /api/leaderboard/match/:matchId/result ────────────────────────────────
// Full match result with rankings and prize breakdown
router.get('/match/:matchId/result', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  // Final rankings
  const rankings = db.prepare(`
    SELECT
      ut.id as user_team_id,
      u.id  as user_id,
      u.name,
      ut.total_fantasy_points,
      ut.match_rank,
      ut.units_won,
      cp.name  as captain_name,
      vcp.name as vc_name,
      pd.gross_units,
      pd.net_units,
      pd.rank as prize_rank
    FROM user_teams ut
    JOIN users u    ON u.id   = ut.user_id
    JOIN players cp  ON cp.id  = COALESCE(ut.resolved_captain_id, ut.captain_id)
    JOIN players vcp ON vcp.id = COALESCE(ut.resolved_vice_captain_id, ut.vice_captain_id)
    LEFT JOIN (
      SELECT user_team_id, gross_units, net_units, rank
      FROM prize_distributions
      WHERE id IN (
        SELECT MAX(id) FROM prize_distributions GROUP BY user_team_id
      )
    ) pd ON pd.user_team_id = ut.id
    WHERE ut.match_id = ?
    ORDER BY ut.total_fantasy_points DESC
  `).all(matchId);

  // Prize pool summary
  const prizePool = db.prepare(
    'SELECT * FROM match_prize_pools WHERE match_id = ?'
  ).get(matchId);

  // Top performers (top 5 individual scores)
  const topPerformers = db.prepare(`
    SELECT
      p.id, p.name, p.team, p.role,
      pms.fantasy_points,
      pms.runs, pms.wickets, pms.catches
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    WHERE pms.match_id = ?
    ORDER BY pms.fantasy_points DESC
    LIMIT 5
  `).all(matchId);

  return res.json({ match, rankings, prizePool, topPerformers });
});

// ── GET /api/leaderboard/user/:userId/history ─────────────────────────────────
// User's match history across a season
router.get('/user/:userId/history', requireAuth, (req, res) => {
  const db       = getDb();
  const userId   = parseInt(req.params.userId, 10);
  const { seasonId } = req.query;

  if (!seasonId) return res.status(400).json({ error: 'seasonId query param required' });

  // Can only view own history or if admin
  if (userId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const history = db.prepare(`
    SELECT
      m.id as match_id, m.team_a, m.team_b, m.start_time, m.status,
      ut.total_fantasy_points,
      ut.match_rank,
      ut.units_won,
      COALESCE(mc.entry_units, 300) as entry_units,
      ut.units_won - COALESCE(mc.entry_units, 300) as net_units
    FROM user_teams ut
    JOIN matches m ON m.id = ut.match_id
    LEFT JOIN match_config mc ON mc.match_id = m.id
    WHERE ut.user_id = ? AND m.season_id = ?
    ORDER BY m.start_time DESC
  `).all(userId, seasonId);

  return res.json({ userId, history });
});

module.exports = router;
