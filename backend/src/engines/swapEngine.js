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
  if (backups.length !== 2) {
    throw new Error('resolveTeam: expected 2 backups, got ' + backups.length);
  }

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

module.exports = { resolveTeam };
