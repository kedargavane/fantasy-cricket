'use strict';

const express    = require('express');
const { getDb }  = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/leaderboard/season/:seasonId ─────────────────────────────────────
router.get('/season/:seasonId', requireAuth, (req, res) => {
  const db = getDb();
  const seasonId = parseInt(req.params.seasonId, 10);

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const totalCompleted = db.prepare(
    "SELECT COUNT(*) as count FROM matches WHERE season_id = ? AND status = 'completed'"
  ).get(seasonId).count;

  const minMatchesRequired = Math.ceil(totalCompleted * 0.25);

  const leaderboard = db.prepare(`
    SELECT
      sl.user_id,
      u.name,
      sl.total_fantasy_points,
      sl.total_units_won,
      sl.net_units,
      sl.matches_played,
      sl.top_finishes,
      CASE WHEN sl.matches_played >= ? THEN 1 ELSE 0 END as is_eligible,
      CASE
        WHEN sl.matches_played > 0 THEN ROUND(CAST(sl.net_units AS REAL) / sl.matches_played, 2)
        ELSE 0
      END as season_score
    FROM season_leaderboard sl
    JOIN users u ON u.id = sl.user_id
    WHERE sl.season_id = ?
    ORDER BY sl.net_units DESC, sl.total_fantasy_points DESC
  `).all(minMatchesRequired, seasonId);

  let rank = 1;
  const result = leaderboard.map((entry, idx) => {
    if (entry.is_eligible) {
      if (idx > 0 && leaderboard[idx - 1].is_eligible &&
          leaderboard[idx - 1].net_units === entry.net_units) {
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

  return res.json({ season, leaderboard: result, totalCompleted, minMatchesRequired });
});

// ── GET /api/leaderboard/match/:matchId/result ────────────────────────────────
router.get('/match/:matchId/result', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

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
    LEFT JOIN prize_distributions pd ON pd.user_team_id = ut.id
    WHERE ut.match_id = ?
    ORDER BY ut.total_fantasy_points DESC
  `).all(matchId);

  const prizePool = db.prepare(
    'SELECT * FROM match_prize_pools WHERE match_id = ?'
  ).get(matchId);

  const topPerformers = db.prepare(`
    SELECT p.id, p.name, p.team, p.role,
      pms.fantasy_points, pms.runs, pms.wickets, pms.catches
    FROM player_match_stats pms
    JOIN players p ON p.id = pms.player_id
    WHERE pms.match_id = ?
    ORDER BY pms.fantasy_points DESC
    LIMIT 5
  `).all(matchId);

  return res.json({ match, rankings, prizePool, topPerformers });
});

// ── GET /api/leaderboard/user/:userId/history ─────────────────────────────────
router.get('/user/:userId/history', requireAuth, (req, res) => {
  const db     = getDb();
  const userId = parseInt(req.params.userId, 10);
  const { seasonId } = req.query;

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const history = db.prepare(`
    SELECT
      m.id as match_id, m.team_a, m.team_b, m.start_time, m.status,
      ut.total_fantasy_points, ut.match_rank, ut.units_won,
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

// ── GET /api/leaderboard/season/:seasonId/form ────────────────────────────────
router.get('/season/:seasonId/form', requireAuth, (req, res) => {
  const db = getDb();
  const seasonId = parseInt(req.params.seasonId, 10);

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const matches = db.prepare(`
    SELECT id, team_a, team_b, start_time FROM matches
    WHERE season_id = ? AND status = 'completed'
    ORDER BY start_time DESC LIMIT 5
  `).all(seasonId);

  const matchIds = matches.map(m => m.id);
  if (matchIds.length === 0) return res.json({ form: [] });

  const rows = db.prepare(`
    SELECT ut.user_id, ut.match_id, ut.match_rank, ut.total_fantasy_points
    FROM user_teams ut
    WHERE ut.match_id IN (${matchIds.map(() => '?').join(',')})
  `).all(...matchIds);

  const byUser = {};
  for (const r of rows) {
    if (!byUser[r.user_id]) byUser[r.user_id] = {};
    byUser[r.user_id][r.match_id] = { rank: r.match_rank, pts: r.total_fantasy_points };
  }

  const form = Object.entries(byUser).map(([userId, matchData]) => ({
    user_id: parseInt(userId),
    last5: matchIds.map(mid => matchData[mid]
      ? { match_id: mid, rank: matchData[mid].rank, pts: matchData[mid].pts }
      : null
    ),
  }));

  return res.json({ form, matches: matches.map(m => ({ id: m.id, team_a: m.team_a, team_b: m.team_b })) });
});

// ── GET /api/leaderboard/season/:seasonId/stats ───────────────────────────────
router.get('/season/:seasonId/stats', requireAuth, (req, res) => {
  const db = getDb();
  const seasonId = parseInt(req.params.seasonId, 10);

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const matches = db.prepare(`
    SELECT id, team_a, team_b, start_time FROM matches
    WHERE season_id = ? AND status = 'completed'
    ORDER BY start_time ASC
  `).all(seasonId);

  const matchRanks = db.prepare(`
    SELECT ut.match_id, u.name as team_name, ut.match_rank
    FROM user_teams ut
    JOIN users u ON u.id = ut.user_id
    JOIN matches m ON m.id = ut.match_id
    WHERE m.season_id = ? AND m.status = 'completed' AND m.id != 39
    ORDER BY m.start_time ASC
  `).all(seasonId);

  const ranksByTeam = {};
  for (const r of matchRanks) {
    if (!ranksByTeam[r.team_name]) ranksByTeam[r.team_name] = {};
    ranksByTeam[r.team_name][r.match_id] = r.match_rank;
  }

  const ENTRY = 300;
  const unitsByIpl = {};
  for (const m of matches) {
    const lb = db.prepare(`
      SELECT u.name, ut.units_won, ut.match_rank
      FROM user_teams ut JOIN users u ON u.id = ut.user_id
      WHERE ut.match_id = ?
    `).all(m.id);
    for (const ipl of [m.team_a, m.team_b]) {
      if (!unitsByIpl[ipl]) unitsByIpl[ipl] = {};
      for (const e of lb) {
        if (!unitsByIpl[ipl][e.name]) unitsByIpl[ipl][e.name] = { units: 0, count: 0, ranks: [] };
        unitsByIpl[ipl][e.name].units += (e.units_won || 0) - ENTRY;
        unitsByIpl[ipl][e.name].count += 1;
        if (e.match_rank) unitsByIpl[ipl][e.name].ranks.push(e.match_rank);
      }
    }
  }

  const capContrib = db.prepare(`
    SELECT
      u.name as team_name,
      AVG(per_match.cap_pts)   as avg_cap,
      AVG(per_match.vc_pts)    as avg_vc,
      AVG(per_match.team_total) as avg_total,
      COUNT(*) as matches
    FROM (
      SELECT
        ut.user_id,
        ut.match_id,
        ut.total_fantasy_points as team_total,
        MAX(CASE WHEN utp.player_id = ut.resolved_captain_id
            THEN pms.fantasy_points * 2.0 ELSE 0 END) as cap_pts,
        MAX(CASE WHEN utp.player_id = ut.resolved_vice_captain_id
            THEN pms.fantasy_points * 1.5 ELSE 0 END) as vc_pts
      FROM user_teams ut
      JOIN matches m ON m.id = ut.match_id
      JOIN user_team_players utp ON utp.user_team_id = ut.id
      JOIN player_match_stats pms ON pms.player_id = utp.player_id AND pms.match_id = ut.match_id
      WHERE m.season_id = ? AND m.status = 'completed' AND m.id != 39
        AND ut.resolved_captain_id IS NOT NULL
      GROUP BY ut.user_id, ut.match_id
    ) per_match
    JOIN users u ON u.id = per_match.user_id
    GROUP BY u.name
  `).all(seasonId);

  const capPicksRaw = db.prepare(`
    SELECT
      u.name as team_name,
      cp.name as captain_name,
      vcp.name as vc_name,
      ut.match_rank,
      pms_cap.fantasy_points as cap_pts,
      pms_vc.fantasy_points as vc_pts
    FROM user_teams ut
    JOIN users u ON u.id = ut.user_id
    JOIN matches m ON m.id = ut.match_id
    LEFT JOIN players cp ON cp.id = ut.resolved_captain_id
    LEFT JOIN players vcp ON vcp.id = ut.resolved_vice_captain_id
    LEFT JOIN player_match_stats pms_cap ON pms_cap.player_id = ut.resolved_captain_id AND pms_cap.match_id = ut.match_id
    LEFT JOIN player_match_stats pms_vc ON pms_vc.player_id = ut.resolved_vice_captain_id AND pms_vc.match_id = ut.match_id
    WHERE m.season_id = ? AND m.status = 'completed' AND m.id != 39
  `).all(seasonId);

  const capPicksAgg = {};
  for (const r of capPicksRaw) {
    if (!capPicksAgg[r.team_name]) capPicksAgg[r.team_name] = { caps: {}, vcs: {} };
    const won = (r.match_rank || 99) <= 3;
    if (r.captain_name) {
      if (!capPicksAgg[r.team_name].caps[r.captain_name])
        capPicksAgg[r.team_name].caps[r.captain_name] = { count: 0, wins: 0, pts: [] };
      capPicksAgg[r.team_name].caps[r.captain_name].count++;
      if (won) capPicksAgg[r.team_name].caps[r.captain_name].wins++;
      if (r.cap_pts) capPicksAgg[r.team_name].caps[r.captain_name].pts.push(Math.round(r.cap_pts * 2));
    }
    if (r.vc_name) {
      if (!capPicksAgg[r.team_name].vcs[r.vc_name])
        capPicksAgg[r.team_name].vcs[r.vc_name] = { count: 0, wins: 0, pts: [] };
      capPicksAgg[r.team_name].vcs[r.vc_name].count++;
      if (won) capPicksAgg[r.team_name].vcs[r.vc_name].wins++;
      if (r.vc_pts) capPicksAgg[r.team_name].vcs[r.vc_name].pts.push(Math.round(r.vc_pts * 1.5));
    }
  }

  const capPicks = {};
  for (const [team, data] of Object.entries(capPicksAgg)) {
    capPicks[team] = {
      caps: Object.entries(data.caps)
        .map(([name, d]) => ({
          name, count: d.count,
          winPct: d.count ? Math.round(d.wins / d.count * 100) : 0,
          avgPts: d.pts.length ? Math.round(d.pts.reduce((a,b)=>a+b,0)/d.pts.length) : 0,
        })).sort((a,b) => b.count - a.count).slice(0, 5),
      vcs: Object.entries(data.vcs)
        .map(([name, d]) => ({
          name, count: d.count,
          winPct: d.count ? Math.round(d.wins / d.count * 100) : 0,
          avgPts: d.pts.length ? Math.round(d.pts.reduce((a,b)=>a+b,0)/d.pts.length) : 0,
        })).sort((a,b) => b.count - a.count).slice(0, 5),
    };
  }

  return res.json({
    seasonId,
    totalMatches: matches.length,
    matches: matches.map(m => ({ id: m.id, team_a: m.team_a, team_b: m.team_b })),
    ranksByTeam,
    unitsByIpl,
    capContrib,
    capPicks,
  });
});

module.exports = router;
