'use strict';

/**
 * matchService.js — shared match finalisation logic
 * Used by both admin routes and cronJobs auto-finalise
 */

const { getDb }             = require('../db/database');
const { recomputeTeamPoints } = require('./syncService');
const { distributePrizes }  = require('../engines/prizeEngine');

function finaliseMatch(matchId) {
  const db = getDb();

  // Get match + season
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) throw new Error(`Match ${matchId} not found`);
  const seasonId = match.season_id;

  // 1. Process auto-swaps
  const { processAutoSwaps } = require('../engines/swapEngine');
  processAutoSwaps(matchId);

  // 2. Final recompute
  recomputeTeamPoints(matchId);

  // 3. Entry units
  const matchConfig = db.prepare('SELECT entry_units FROM match_config WHERE match_id = ?').get(matchId);
  const entryUnits  = matchConfig ? matchConfig.entry_units : 300;

  // 4. Rank teams
  const teams = db.prepare(`
    SELECT id as userId, total_fantasy_points as fantasyPoints
    FROM user_teams WHERE match_id = ?
    ORDER BY total_fantasy_points DESC
  `).all(matchId).map(t => ({ userId: t.userId, fantasyPoints: t.fantasyPoints }));

  // 5. Distribute prizes
  const { totalPool, distributionRule, prizes, participantCount } =
    distributePrizes(teams, entryUnits);

  // 6. Write prize pool
  const poolResult = db.prepare(`
    INSERT INTO match_prize_pools
      (match_id, participants_count, total_units, winners_count, distribution_rule, is_finalized, finalized_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(match_id) DO UPDATE SET
      participants_count = excluded.participants_count,
      total_units        = excluded.total_units,
      winners_count      = excluded.winners_count,
      distribution_rule  = excluded.distribution_rule,
      is_finalized       = 1,
      finalized_at       = datetime('now')
  `).run(matchId, participantCount, totalPool,
    prizes.filter(p => p.grossUnits > 0).length,
    distributionRule);

  // lastInsertRowid is 0 on ON CONFLICT UPDATE — always fetch the actual id
  const poolId = db.prepare('SELECT id FROM match_prize_pools WHERE match_id = ?').get(matchId)?.id;
  if (!poolId) throw new Error('Failed to create/find prize pool');

  // 7. Write prize distributions
  const insertPrize = db.prepare(`
    INSERT INTO prize_distributions
      (match_prize_pool_id, user_team_id, rank, gross_units, net_units, fantasy_points)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateTeam = db.prepare(`
    UPDATE user_teams SET match_rank = ?, units_won = ?, finalized_at = datetime('now') WHERE id = ?
  `);

  const doFinalise = db.transaction(() => {
    // Clear existing distributions for this pool (re-finalise case)
    db.prepare('DELETE FROM prize_distributions WHERE match_prize_pool_id = ?').run(poolId);
    for (const prize of prizes) {
      const teamExists = db.prepare('SELECT id FROM user_teams WHERE id = ?').get(prize.userId);
      if (!teamExists) throw new Error(`user_team ${prize.userId} not found in user_teams`);
      insertPrize.run(poolId, prize.userId, prize.rank, prize.grossUnits, prize.netUnits, prize.fantasyPoints);
      updateTeam.run(prize.rank, prize.grossUnits, prize.userId);
    }
    db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").run(matchId);
  });
  doFinalise();

  // 8. Update season leaderboard
  updateSeasonLeaderboard(db, matchId, seasonId, prizes, entryUnits);

  // 9. Push notifications (async, don't await)
  sendResultNotifications(db, matchId, prizes).catch(e =>
    console.error(`[finalise] notification error match ${matchId}:`, e.message)
  );

  console.log(`[finalise] Match ${matchId} finalised — ${prizes.length} teams, pool ${totalPool}u`);
  return { prizes, totalPool, distributionRule };
}

function updateSeasonLeaderboard(db, matchId, seasonId, prizes, entryUnits) {
  const updateLeaderboard = db.prepare(`
    INSERT INTO season_leaderboard (season_id, user_id, total_fantasy_points, total_units_won, net_units, matches_played, top_finishes, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      total_fantasy_points = total_fantasy_points + excluded.total_fantasy_points,
      total_units_won      = total_units_won + excluded.total_units_won,
      net_units            = net_units + excluded.net_units,
      matches_played       = matches_played + 1,
      top_finishes         = top_finishes + excluded.top_finishes,
      updated_at           = datetime('now')
  `);

  const updateAll = db.transaction(() => {
    for (const prize of prizes) {
      const userTeam = db.prepare('SELECT user_id FROM user_teams WHERE id = ?').get(prize.userId);
      if (!userTeam) continue;
      updateLeaderboard.run(
        seasonId, userTeam.user_id,
        prize.fantasyPoints, prize.grossUnits, prize.netUnits,
        prize.grossUnits > 0 ? 1 : 0
      );
    }
  });
  updateAll();
}

async function sendResultNotifications(db, matchId, prizes) {
  const webpush = require('web-push');
  const match   = db.prepare('SELECT team_a, team_b FROM matches WHERE id = ?').get(matchId);

  for (const prize of prizes) {
    const userTeam = db.prepare('SELECT user_id FROM user_teams WHERE id = ?').get(prize.userId);
    if (!userTeam) continue;
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userTeam.user_id);
    const payload = JSON.stringify({
      title: `Result: ${match.team_a} vs ${match.team_b}`,
      body:  prize.grossUnits > 0
        ? `You finished #${prize.rank} and won ${prize.grossUnits}u!`
        : `You finished #${prize.rank}. Better luck next match!`,
    });
    for (const sub of subs) {
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(() => {});
    }
  }
}

module.exports = { finaliseMatch, updateSeasonLeaderboard };
