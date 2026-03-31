'use strict';

/**
 * Resolve a user's final team after auto-swap logic is applied.
 *
 * Rules:
 *  - User picks 11 main players + 2 ordered backups (B1, B2)
 *  - At match start, any main player not in Playing XI is swapped out
 *  - First non-XI main player -> B1 (if B1 is in XI), else slot scores 0
 *  - Second non-XI main player -> B2 (if B2 is in XI), else slot scores 0
 *  - Backups are consumed in order: B1 for 1st non-XI, B2 for 2nd
 *  - If a backup is also not in XI, that slot scores 0, backup is still consumed
 *  - C/VC roles transfer to the swapped-in backup
 *
 * @param {object} userTeam
 * @param {Array}  userTeam.mainPlayers    - Array of exactly 11 player objects
 * @param {Array}  userTeam.backups        - Array of exactly 2 player objects [B1, B2]
 * @param {string} userTeam.captainId      - player id of captain
 * @param {string} userTeam.viceCaptainId  - player id of vice-captain
 *
 * Each player object: { id, name, ...anyOtherFields }
 *
 * @param {Set|Array} playingXiIds - IDs of players confirmed in Playing XI
 *
 * @returns {{ finalTeam, captainId, viceCaptainId, swapLog }}
 */
function resolveTeam(userTeam, playingXiIds) {
  const xiSet = new Set(playingXiIds);
  const { mainPlayers, backups, captainId, viceCaptainId } = userTeam;

  if (mainPlayers.length !== 11) {
    throw new Error('resolveTeam: expected 11 main players, got ' + mainPlayers.length);
  }
  // Backups are optional — pad with empty array if missing
  while (backups.length < 2) backups.push({ id: -1, name: 'No backup' });

  const finalTeam          = [...mainPlayers];
  let   finalCaptainId     = captainId;
  let   finalViceCaptainId = viceCaptainId;
  const swapLog            = [];
  let   backupIndex        = 0;

  for (let i = 0; i < finalTeam.length; i++) {
    const player = finalTeam[i];
    if (xiSet.has(player.id)) continue;

    // Player not in XI
    if (backupIndex >= backups.length) {
      swapLog.push({ type: 'no_backup_available', slotIndex: i, player });
      continue;
    }

    const backup = backups[backupIndex];
    backupIndex++;

    if (!xiSet.has(backup.id)) {
      swapLog.push({
        type: 'backup_not_in_xi',
        slotIndex: i,
        originalPlayer: player,
        backup,
        result: 'slot_scores_zero',
      });
      continue;
    }

    const inheritedRole =
      player.id === captainId     ? 'captain'      :
      player.id === viceCaptainId ? 'vice_captain'  :
      null;

    finalTeam[i] = backup;
    if (inheritedRole === 'captain')      finalCaptainId     = backup.id;
    if (inheritedRole === 'vice_captain') finalViceCaptainId = backup.id;

    swapLog.push({
      type: 'swapped',
      slotIndex: i,
      swappedOut: player,
      swappedIn:  backup,
      inheritedRole,
    });
  }

  return { finalTeam, captainId: finalCaptainId, viceCaptainId: finalViceCaptainId, swapLog };
}

function processAutoSwaps(matchId) {
  const { getDb } = require('../db/database');
  const db = getDb();

  const xiPlayers = db.prepare(
    'SELECT player_id FROM match_squads WHERE match_id = ? AND is_playing_xi = 1'
  ).all(matchId);
  const playingXiIds = new Set(xiPlayers.map(r => r.player_id));

  const userTeams = db.prepare(`
    SELECT id, user_id, captain_id, vice_captain_id
    FROM user_teams
    WHERE match_id = ? AND swap_processed_at IS NULL AND locked_at IS NOT NULL
  `).all(matchId);

  const getTeamPlayers = db.prepare(`
    SELECT p.id, p.name, utp.is_backup, utp.backup_order
    FROM user_team_players utp
    JOIN players p ON p.id = utp.player_id
    WHERE utp.user_team_id = ?
    ORDER BY utp.is_backup ASC, utp.backup_order ASC
  `);

  const updateResolved = db.prepare(`
    UPDATE user_teams SET
      resolved_captain_id      = ?,
      resolved_vice_captain_id = ?,
      swap_processed_at        = datetime('now')
    WHERE id = ?
  `);

  const insertSwapLog = db.prepare(`
    INSERT OR IGNORE INTO user_team_swaps
      (user_team_id, swapped_out_player_id, swapped_in_player_id, inherited_role)
    VALUES (?, ?, ?, ?)
  `);

  const swapResults = []; // { userId, teamId, swaps: [{out, in}], noSwapNeeded: bool }

  const processAll = db.transaction(() => {
    for (const team of userTeams) {
      const allPlayers  = getTeamPlayers.all(team.id);
      const mainPlayers = allPlayers.filter(p => !p.is_backup);
      const backups     = allPlayers.filter(p => p.is_backup)
                                    .sort((a, b) => a.backup_order - b.backup_order);

      if (mainPlayers.length === 0) continue;

      const resolved = resolveTeam(
        { mainPlayers, backups, captainId: team.captain_id, viceCaptainId: team.vice_captain_id },
        playingXiIds
      );

      updateResolved.run(resolved.captainId, resolved.viceCaptainId, team.id);

      const teamSwaps = [];
      for (const swap of resolved.swapLog) {
        if (swap.type === 'swapped') {
          try {
            insertSwapLog.run(team.id, swap.swappedOut.id, swap.swappedIn.id, swap.inheritedRole);
            teamSwaps.push({ out: swap.swappedOut.name, in: swap.swappedIn.name });
          } catch {}
        }
      }

      swapResults.push({
        userId: team.user_id,
        teamId: team.id,
        swaps: teamSwaps,
        noSwapNeeded: resolved.swapLog.length === 0,
      });
    }
  });

  processAll();
  return { teamsProcessed: userTeams.length, swapResults };
}

module.exports = { resolveTeam, processAutoSwaps };
