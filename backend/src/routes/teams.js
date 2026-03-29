'use strict';

const express = require('express');
const { calculateFantasyPoints, DEFAULT_SCORING_CONFIG } = require('../engines/scoringEngine');
const { getDb }       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/teams ───────────────────────────────────────────────────────────
// Submit a team for a match
router.post('/', requireAuth, (req, res) => {
  const { matchId, playerIds, captainId, viceCaptainId, backupIds } = req.body;

  // ── Validate input ──
  const err = validateTeamInput({ matchId, playerIds, captainId, viceCaptainId, backupIds });
  if (err) return res.status(400).json({ error: err });

  const db = getDb();

  // ── Check match exists and is not locked ──
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'upcoming') {
    return res.status(400).json({ error: 'Team submission is closed — match has started' });
  }

  // ── Check user is in this match's season ──
  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member of this season' });

  // ── Check no existing team for this match ──
  const existing = db.prepare(
    'SELECT id FROM user_teams WHERE user_id = ? AND match_id = ?'
  ).get(req.user.id, matchId);
  if (existing) return res.status(400).json({ error: 'You already have a team for this match' });

  // ── Validate all players are in the match squad ──
  const allPlayerIds = [...playerIds, ...backupIds];
  const squadPlayerIds = new Set(
    db.prepare('SELECT player_id FROM match_squads WHERE match_id = ?')
      .all(matchId)
      .map(r => r.player_id)
  );

  for (const pid of allPlayerIds) {
    if (!squadPlayerIds.has(pid)) {
      return res.status(400).json({ error: `Player ${pid} is not in the match squad` });
    }
  }

  // ── Validate captain and VC are in main 11 (not backups) ──
  if (!playerIds.includes(captainId)) {
    return res.status(400).json({ error: 'Captain must be in your main 11' });
  }
  if (!playerIds.includes(viceCaptainId)) {
    return res.status(400).json({ error: 'Vice-captain must be in your main 11' });
  }
  if (captainId === viceCaptainId) {
    return res.status(400).json({ error: 'Captain and vice-captain must be different players' });
  }

  // ── No duplicates across main + backups ──
  const uniqueAll = new Set(allPlayerIds);
  if (uniqueAll.size !== allPlayerIds.length) {
    return res.status(400).json({ error: 'Duplicate players detected' });
  }

  // ── Save team ──
  try {
    const saveTeam = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO user_teams (user_id, match_id, captain_id, vice_captain_id)
        VALUES (?, ?, ?, ?)
      `).run(req.user.id, matchId, captainId, viceCaptainId);

      const userTeamId = result.lastInsertRowid;

      const insertPlayer = db.prepare(`
        INSERT INTO user_team_players (user_team_id, player_id, is_backup, backup_order)
        VALUES (?, ?, ?, ?)
      `);

      for (const pid of playerIds) {
        insertPlayer.run(userTeamId, pid, 0, null);
      }

      backupIds.forEach((pid, idx) => {
        insertPlayer.run(userTeamId, pid, 1, idx + 1);
      });

      return userTeamId;
    });

    const userTeamId = saveTeam();
    const team       = getTeamDetail(db, userTeamId, req.user.id);
    return res.status(201).json({ message: 'Team submitted successfully', team });
  } catch (err) {
    console.error('[teams/post]', err.message);
    return res.status(500).json({ error: 'Failed to save team' });
  }
});

// ── GET /api/teams/match/:matchId ─────────────────────────────────────────────
// Get my team for a specific match
router.get('/match/:matchId', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const userTeam = db.prepare(
    'SELECT id FROM user_teams WHERE user_id = ? AND match_id = ?'
  ).get(req.user.id, matchId);

  if (!userTeam) return res.status(404).json({ error: 'No team found for this match' });

  const team = getTeamDetail(db, userTeam.id, req.user.id);
  return res.json({ team });
});

// ── GET /api/teams/:userTeamId ────────────────────────────────────────────────
// Get any user's team (for leaderboard view — only after match locks)
router.get('/:userTeamId', requireAuth, (req, res) => {
  const db         = getDb();
  const userTeamId = parseInt(req.params.userTeamId, 10);

  const userTeam = db.prepare(
    'SELECT ut.*, m.season_id, m.status as match_status FROM user_teams ut JOIN matches m ON m.id = ut.match_id WHERE ut.id = ?'
  ).get(userTeamId);

  if (!userTeam) return res.status(404).json({ error: 'Team not found' });

  // Only reveal other users' teams after match has locked
  if (userTeam.user_id !== req.user.id && userTeam.match_status === 'upcoming') {
    return res.status(403).json({ error: 'Teams are hidden until match starts' });
  }

  // Check viewer is in same season
  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(userTeam.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const team = getTeamDetail(db, userTeamId, userTeam.user_id);
  return res.json({ team });
});

// ── PUT /api/teams/match/:matchId ─────────────────────────────────────────────
// Edit team before match locks
router.put('/match/:matchId', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const { playerIds, captainId, viceCaptainId, backupIds } = req.body;

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'upcoming') {
    return res.status(400).json({ error: 'Cannot edit team — match has started' });
  }

  const userTeam = db.prepare(
    'SELECT id FROM user_teams WHERE user_id = ? AND match_id = ?'
  ).get(req.user.id, matchId);
  if (!userTeam) return res.status(404).json({ error: 'No team found to edit' });

  const err = validateTeamInput({ matchId, playerIds, captainId, viceCaptainId, backupIds });
  if (err) return res.status(400).json({ error: err });

  // Validate all players in squad
  const allPlayerIds = [...playerIds, ...backupIds];
  const squadPlayerIds = new Set(
    db.prepare('SELECT player_id FROM match_squads WHERE match_id = ?')
      .all(matchId).map(r => r.player_id)
  );
  for (const pid of allPlayerIds) {
    if (!squadPlayerIds.has(pid)) {
      return res.status(400).json({ error: `Player ${pid} is not in the match squad` });
    }
  }

  try {
    const updateTeam = db.transaction(() => {
      // Delete existing players and re-insert
      db.prepare('DELETE FROM user_team_players WHERE user_team_id = ?').run(userTeam.id);

      db.prepare(`
        UPDATE user_teams SET captain_id = ?, vice_captain_id = ?,
          resolved_captain_id = NULL, resolved_vice_captain_id = NULL
        WHERE id = ?
      `).run(captainId, viceCaptainId, userTeam.id);

      const insertPlayer = db.prepare(`
        INSERT INTO user_team_players (user_team_id, player_id, is_backup, backup_order)
        VALUES (?, ?, ?, ?)
      `);

      for (const pid of playerIds) insertPlayer.run(userTeam.id, pid, 0, null);
      backupIds.forEach((pid, idx) => insertPlayer.run(userTeam.id, pid, 1, idx + 1));
    });

    updateTeam();
    const team = getTeamDetail(db, userTeam.id, req.user.id);
    return res.json({ message: 'Team updated successfully', team });
  } catch (err) {
    console.error('[teams/put]', err.message);
    return res.status(500).json({ error: 'Failed to update team' });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateTeamInput({ matchId, playerIds, captainId, viceCaptainId, backupIds }) {
  if (!matchId)                              return 'matchId is required';
  if (!Array.isArray(playerIds) || playerIds.length !== 11)
                                             return 'playerIds must be an array of exactly 11 players';
  if (!Array.isArray(backupIds) || backupIds.length !== 2)
                                             return 'backupIds must be an array of exactly 2 players';
  if (!captainId)                            return 'captainId is required';
  if (!viceCaptainId)                        return 'viceCaptainId is required';
  return null;
}

function getTeamDetail(db, userTeamId, userId) {
  const team = db.prepare(`
    SELECT
      ut.*,
      u.name as user_name,
      m.team_a, m.team_b, m.status as match_status, m.start_time,
      cp.name  as captain_name,
      vcp.name as vc_name,
      rcp.name  as resolved_captain_name,
      rvcp.name as resolved_vc_name
    FROM user_teams ut
    JOIN users u     ON u.id   = ut.user_id
    JOIN matches m   ON m.id   = ut.match_id
    JOIN players cp  ON cp.id  = ut.captain_id
    JOIN players vcp ON vcp.id = ut.vice_captain_id
    LEFT JOIN players rcp  ON rcp.id  = ut.resolved_captain_id
    LEFT JOIN players rvcp ON rvcp.id = ut.resolved_vice_captain_id
    WHERE ut.id = ?
  `).get(userTeamId);

  const players = db.prepare(`
    SELECT
      p.id, p.name, p.team, p.role,
      utp.is_backup, utp.backup_order,
      pms.runs, pms.balls_faced, pms.fours, pms.sixes,
      pms.overs_bowled, pms.wickets, pms.runs_conceded,
      pms.catches, pms.stumpings, pms.run_outs,
      pms.maidens,
      pms.fantasy_points as base_fantasy_points,
      pms.dismissal_type,
      ms.is_playing_xi,
      -- determine effective role
      CASE
        WHEN p.id = COALESCE(ut.resolved_captain_id,     ut.captain_id)     THEN 'captain'
        WHEN p.id = COALESCE(ut.resolved_vice_captain_id, ut.vice_captain_id) THEN 'vice_captain'
        ELSE 'normal'
      END as role_in_team
    FROM user_team_players utp
    JOIN players p   ON p.id  = utp.player_id
    JOIN user_teams ut ON ut.id = utp.user_team_id
    LEFT JOIN player_match_stats pms ON pms.player_id = p.id AND pms.match_id = ut.match_id
    LEFT JOIN match_squads ms ON ms.player_id = p.id AND ms.match_id = ut.match_id
    WHERE utp.user_team_id = ?
    ORDER BY utp.is_backup ASC, utp.backup_order ASC NULLS FIRST
  `).all(userTeamId);

  // Swap log
  const swaps = db.prepare(`
    SELECT
      uts.*,
      po.name as swapped_out_name,
      pi.name as swapped_in_name
    FROM user_team_swaps uts
    LEFT JOIN players po ON po.id = uts.swapped_out_player_id
    LEFT JOIN players pi ON pi.id = uts.swapped_in_player_id
    WHERE uts.user_team_id = ?
  `).all(userTeamId);

  // Add scoring breakdown to each player
  const playersWithBreakdown = players.map(p => {
    const { breakdown } = calculateFantasyPoints({
      isPlayingXi:   p.is_playing_xi,
      runs:          p.runs,
      ballsFaced:    p.balls_faced,
      fours:         p.fours,
      sixes:         p.sixes,
      dismissalType: p.dismissal_type,
      oversBowled:   p.overs_bowled,
      wickets:       p.wickets,
      runsConceded:  p.runs_conceded,
      maidens:       p.maidens,
      catches:       p.catches,
      stumpings:     p.stumpings,
      runOuts:       p.run_outs,
    }, 'normal', DEFAULT_SCORING_CONFIG);
    return { ...p, breakdown };
  });

  return { ...team, players: playersWithBreakdown, swaps };
}

module.exports = router;

// ── GET /api/teams/compare/:matchId ──────────────────────────────────────────
// Compare two user teams for a match
// Query: ?userA=userId&userB=userId
router.get('/compare/:matchId', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const { userA, userB } = req.query;

  if (!userA || !userB) {
    return res.status(400).json({ error: 'userA and userB query params required' });
  }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Teams only visible after match locks
  if (match.status === 'upcoming') {
    return res.status(403).json({ error: 'Teams are hidden until match starts' });
  }

  // Verify viewer is in season
  const member = db.prepare(
    'SELECT id FROM season_memberships WHERE season_id = ? AND user_id = ?'
  ).get(match.season_id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  function getTeam(userId) {
    const ut = db.prepare(
      'SELECT ut.*, u.name as user_name FROM user_teams ut JOIN users u ON u.id = ut.user_id WHERE ut.match_id = ? AND ut.user_id = ?'
    ).get(matchId, userId);
    if (!ut) return null;

    const players = db.prepare(`
      SELECT
        p.id, p.name, p.team, p.role,
        utp.is_backup, utp.backup_order,
        pms.fantasy_points as base_pts,
        ms.is_playing_xi,
        CASE
          WHEN p.id = COALESCE(ut.resolved_captain_id, ut.captain_id) THEN 'captain'
          WHEN p.id = COALESCE(ut.resolved_vice_captain_id, ut.vice_captain_id) THEN 'vice_captain'
          ELSE 'normal'
        END as role_in_team
      FROM user_team_players utp
      JOIN players p ON p.id = utp.player_id
      JOIN user_teams ut ON ut.id = utp.user_team_id
      LEFT JOIN player_match_stats pms ON pms.player_id = p.id AND pms.match_id = ut.match_id
      LEFT JOIN match_squads ms ON ms.player_id = p.id AND ms.match_id = ut.match_id
      WHERE utp.user_team_id = ?
      ORDER BY utp.is_backup ASC, pms.fantasy_points DESC NULLS LAST
    `).all(ut.id);

    // Compute effective points with multipliers
    const playersWithPts = players.map(p => {
      const mult = p.role_in_team === 'captain' ? 2 : p.role_in_team === 'vice_captain' ? 1.5 : 1;
      return { ...p, effective_pts: Math.round((p.base_pts || 0) * mult) };
    });

    // Get swap log
    const swaps = db.prepare(`
      SELECT uts.swapped_out_player_id, uts.swapped_in_player_id, uts.inherited_role
      FROM user_team_swaps uts WHERE uts.user_team_id = ?
    `).all(ut.id);

    const swappedOutIds = new Set(swaps.map(s => s.swapped_out_player_id));
    const swappedInIds  = new Set(swaps.map(s => s.swapped_in_player_id));

    // Resolve active 11: mains (not swapped out) + swapped-in backups
    const active11 = playersWithPts.filter(p => {
      if (!p.is_backup) return !swappedOutIds.has(p.id); // main not swapped out
      return swappedInIds.has(p.id);                      // backup that came in
    });

    return { ...ut, players: active11, swaps };
  }

  const teamA = getTeam(parseInt(userA));
  const teamB = getTeam(parseInt(userB));

  if (!teamA || !teamB) {
    return res.status(404).json({ error: 'One or both teams not found' });
  }

  // Find common and unique players
  const idsA = new Set(teamA.players.map(p => p.id));
  const idsB = new Set(teamB.players.map(p => p.id));

  const common  = teamA.players.filter(p => idsB.has(p.id)).map(p => p.id);
  const commonSet = new Set(common);

  const uniqueA = teamA.players.filter(p => !commonSet.has(p.id));
  const uniqueB = teamB.players.filter(p => !idsA.has(p.id));

  // Stats
  const commonPtsA = teamA.players.filter(p => commonSet.has(p.id)).reduce((s, p) => s + p.effective_pts, 0);
  const commonPtsB = teamB.players.filter(p => commonSet.has(p.id)).reduce((s, p) => s + p.effective_pts, 0);
  const uniquePtsA = uniqueA.reduce((s, p) => s + p.effective_pts, 0);
  const uniquePtsB = uniqueB.reduce((s, p) => s + p.effective_pts, 0);

  const capA = teamA.players.find(p => p.role_in_team === 'captain');
  const capB = teamB.players.find(p => p.role_in_team === 'captain');
  const capAdvantage = capA && capB
    ? { player: capA.name, ptsA: capA.effective_pts, ptsB: capB ? teamB.players.find(p => p.id === capA.id)?.effective_pts || 0 : 0 }
    : null;

  return res.json({
    match,
    teamA: { ...teamA, uniquePlayers: uniqueA, uniquePts: uniquePtsA },
    teamB: { ...teamB, uniquePlayers: uniqueB, uniquePts: uniquePtsB },
    common: {
      playerIds: common,
      count: common.length,
      ptsA: commonPtsA,
      ptsB: commonPtsB,
    },
    analysis: {
      totalGap: teamA.total_fantasy_points - teamB.total_fantasy_points,
      uniquePtsDelta: uniquePtsA - uniquePtsB,
      commonPtsDelta: commonPtsA - commonPtsB,
      captainA: capA ? { name: capA.name, pts: capA.effective_pts } : null,
      captainB: capB ? { name: capB.name, pts: capB.effective_pts } : null,
    },
  });
});

// ── POST /api/teams/match/:matchId ───────────────────────────────────────────
// Alias used by frontend — injects matchId into body and calls main submit
router.post('/match/:matchId', requireAuth, async (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const userId  = req.user.id;
  const { playerIds, backupIds, captainId, viceCaptainId } = req.body;

  if (!Array.isArray(playerIds) || playerIds.length !== 11) {
    return res.status(400).json({ error: '11 playerIds required' });
  }
  if (!Array.isArray(backupIds)) backupIds = [];
  if (backupIds.length > 2) {
    return res.status(400).json({ error: 'Maximum 2 backups allowed' });
  }
  if (!captainId || !viceCaptainId) {
    return res.status(400).json({ error: 'captainId and viceCaptainId required' });
  }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'upcoming') return res.status(400).json({ error: 'Team selection is locked' });

  const existing = db.prepare('SELECT id FROM user_teams WHERE user_id=? AND match_id=?').get(userId, matchId);
  if (existing) return res.status(400).json({ error: 'Team already submitted. Use PUT to update.' });

  const saveTeam = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO user_teams (user_id, match_id, captain_id, vice_captain_id, resolved_captain_id, resolved_vice_captain_id, locked_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
    `).run(userId, matchId, captainId, viceCaptainId, captainId, viceCaptainId);
    const utId = result.lastInsertRowid;
    const ins = db.prepare('INSERT INTO user_team_players (user_team_id,player_id,is_backup,backup_order) VALUES (?,?,?,?)');
    for (const pid of playerIds) ins.run(utId, pid, 0, null);
    backupIds.forEach((pid, i) => ins.run(utId, pid, 1, i + 1));
    db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id,user_id) VALUES (?,?)').run(match.season_id, userId);
    return utId;
  });

  try {
    const utId = saveTeam();
    return res.status(201).json({ message: 'Team submitted', userTeamId: utId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/teams/:userTeamId ────────────────────────────────────────────────
// Update existing team by userTeamId — used by frontend edit flow
router.put('/:userTeamId', requireAuth, (req, res) => {
  const db         = getDb();
  const userTeamId = parseInt(req.params.userTeamId, 10);
  const userId     = req.user.id;
  const { playerIds, backupIds, captainId, viceCaptainId } = req.body;

  if (!Array.isArray(playerIds) || playerIds.length !== 11) {
    return res.status(400).json({ error: '11 playerIds required' });
  }
  if (!Array.isArray(backupIds)) backupIds = [];
  if (backupIds.length > 2) {
    return res.status(400).json({ error: 'Maximum 2 backups allowed' });
  }
  if (!captainId || !viceCaptainId) {
    return res.status(400).json({ error: 'captainId and viceCaptainId required' });
  }

  const userTeam = db.prepare(
    'SELECT ut.*, m.status FROM user_teams ut JOIN matches m ON m.id = ut.match_id WHERE ut.id = ? AND ut.user_id = ?'
  ).get(userTeamId, userId);

  if (!userTeam) return res.status(404).json({ error: 'Team not found' });
  if (userTeam.status !== 'upcoming') return res.status(400).json({ error: 'Match has started — team is locked' });

  const update = db.transaction(() => {
    // Delete existing players
    db.prepare('DELETE FROM user_team_players WHERE user_team_id = ?').run(userTeamId);

    // Update captain/VC
    db.prepare(`
      UPDATE user_teams SET
        captain_id = ?, vice_captain_id = ?,
        resolved_captain_id = ?, resolved_vice_captain_id = ?,
        locked_at = datetime('now')
      WHERE id = ?
    `).run(captainId, viceCaptainId, captainId, viceCaptainId, userTeamId);

    // Insert new players
    const ins = db.prepare('INSERT INTO user_team_players (user_team_id,player_id,is_backup,backup_order) VALUES (?,?,?,?)');
    for (const pid of playerIds) ins.run(userTeamId, pid, 0, null);
    backupIds.forEach((pid, i) => ins.run(userTeamId, pid, 1, i + 1));
  });

  try {
    update();
    return res.json({ message: 'Team updated successfully', userTeamId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/teams/user/:userId/match/:matchId ────────────────────────────────
// Get any user's team for a match (only after match locks)
router.get('/user/:userId/match/:matchId', requireAuth, (req, res) => {
  const db      = getDb();
  const matchId = parseInt(req.params.matchId, 10);
  const userId  = parseInt(req.params.userId, 10);

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (match.status === 'upcoming' && userId !== req.user.id) {
    return res.status(403).json({ error: 'Teams hidden until match starts' });
  }

  const ut = db.prepare(
    'SELECT ut.*, u.name as user_name FROM user_teams ut JOIN users u ON u.id = ut.user_id WHERE ut.match_id = ? AND ut.user_id = ?'
  ).get(matchId, userId);

  if (!ut) return res.status(404).json({ error: 'No team found' });

  const players = db.prepare(`
    SELECT p.id, p.name, p.team, p.role,
      utp.is_backup, utp.backup_order,
      pms.fantasy_points,
      pms.runs, pms.balls_faced, pms.fours, pms.sixes,
      pms.overs_bowled, pms.wickets, pms.runs_conceded,
      pms.catches, pms.stumpings, pms.run_outs,
      pms.maidens, pms.dismissal_type,
      ms.is_playing_xi,
      CASE
        WHEN p.id = COALESCE(ut.resolved_captain_id, ut.captain_id) THEN 'captain'
        WHEN p.id = COALESCE(ut.resolved_vice_captain_id, ut.vice_captain_id) THEN 'vice_captain'
        ELSE 'normal'
      END as role_in_team
    FROM user_team_players utp
    JOIN players p ON p.id = utp.player_id
    JOIN user_teams ut ON ut.id = utp.user_team_id
    LEFT JOIN player_match_stats pms ON pms.player_id = p.id AND pms.match_id = ut.match_id
    LEFT JOIN match_squads ms ON ms.player_id = p.id AND ms.match_id = ut.match_id
    WHERE utp.user_team_id = ?
    ORDER BY utp.is_backup ASC, pms.fantasy_points DESC NULLS LAST
  `).all(ut.id);

  // Add scoring breakdown
  const swaps = db.prepare(
    'SELECT swapped_out_player_id, swapped_in_player_id FROM user_team_swaps WHERE user_team_id = ?'
  ).all(ut.id);

  const playersWithBreakdown = players.map(p => {
    const { breakdown } = calculateFantasyPoints({
      isPlayingXi:   p.is_playing_xi,
      runs:          p.runs,
      ballsFaced:    p.balls_faced,
      fours:         p.fours,
      sixes:         p.sixes,
      dismissalType: p.dismissal_type,
      oversBowled:   p.overs_bowled,
      wickets:       p.wickets,
      runsConceded:  p.runs_conceded,
      maidens:       p.maidens,
      catches:       p.catches,
      stumpings:     p.stumpings,
      runOuts:       p.run_outs,
    }, 'normal', DEFAULT_SCORING_CONFIG);
    return { ...p, breakdown };
  });

  return res.json({ team: { ...ut, players: playersWithBreakdown, swaps } });
});
