'use strict';

const cron = require('node-cron');
const { getDb }          = require('../db/database');
const { syncLiveMatch, processAutoSwaps } = require('../api/syncService');
const { fetchMatchInfo } = require('../api/cricapi');
const { runAutoSchedule } = require('../api/autoSchedule');

let jobs = [];

/**
 * POLLING STRATEGY — stays within CricAPI free tier (100 calls/day)
 *
 * Per live match we make two types of API calls:
 *  - "check" call  : match_info — cheap, returns current ball count (~1KB)
 *  - "sync" call   : match_scorecard — full stats, triggers recompute
 *
 * We check every 90 seconds. We only sync when ball count has advanced by 3+.
 * This gives roughly 80 scorecard calls per match + ~8 overhead = 88 total.
 *
 * Ball count tracking is stored in-memory in matchBallCount map.
 * If server restarts mid-match we do one immediate sync to catch up.
 */
const matchBallCount = new Map(); // matchId → last synced total balls

function oversToTotalBalls(overs) {
  if (!overs) return 0;
  const o = parseFloat(overs);
  const completed = Math.floor(o);
  const balls     = Math.round((o - completed) * 10);
  return completed * 6 + balls;
}

function startCronJobs(io) {

  // ── 1. Smart live poller — every 90 seconds ───────────────────────────────
  // Checks ball count cheaply, only fetches full scorecard every 3 balls
  const livePoller = cron.schedule('*/90 * * * * *', async () => {
    const db = getDb();
    const liveMatches = db.prepare(
      "SELECT id, external_match_id FROM matches WHERE status = 'live'"
    ).all();

    if (liveMatches.length === 0) return;

    for (const match of liveMatches) {
      try {
        // Cheap call: just get current ball count and match state
        const info = await fetchMatchInfo(match.external_match_id);

        // Check if match just ended
        if (info.matchEnded) {
          const result = await syncLiveMatch(match.id, match.external_match_id);
          if (result.success) {
            io.to(`match:${match.id}`).emit('statsUpdate', {
              matchId: match.id, playersUpdated: result.playersUpdated,
              timestamp: new Date().toISOString(),
            });
            io.to(`match:${match.id}`).emit('matchCompleted', { matchId: match.id });
            console.log(`[livePoller] Match ${match.id} completed.`);
            matchBallCount.delete(match.id);
          }
          continue;
        }

        // Parse current ball count from t1i/t2i score fields
        const currentBalls = getMatchBallCount(info);
        const lastBalls    = matchBallCount.get(match.id) ?? -3; // force first sync

        if (currentBalls - lastBalls >= 3) {
          // 3+ balls since last sync — do full scorecard fetch
          console.log(`[livePoller] Match ${match.id}: balls ${lastBalls}→${currentBalls}, syncing...`);
          const result = await syncLiveMatch(match.id, match.external_match_id);

          if (result.success) {
            matchBallCount.set(match.id, currentBalls);
            io.to(`match:${match.id}`).emit('statsUpdate', {
              matchId: match.id, playersUpdated: result.playersUpdated,
              timestamp: new Date().toISOString(),
            });
          }
        }
        // else: fewer than 3 new balls — skip the expensive scorecard call

      } catch (err) {
        console.error(`[livePoller] match ${match.id} error:`, err.message);
      }
    }
  });

  // ── 2. Auto-swap trigger — every 60 seconds ───────────────────────────────
  const swapTrigger = cron.schedule('* * * * *', () => {
    const db = getDb();
    const pendingSwapMatches = db.prepare(`
      SELECT DISTINCT m.id
      FROM matches m
      JOIN user_teams ut ON ut.match_id = m.id
      WHERE m.status = 'live'
        AND ut.swap_processed_at IS NULL
        AND ut.locked_at IS NOT NULL
    `).all();

    for (const { id: matchId } of pendingSwapMatches) {
      try {
        const count = processAutoSwaps(matchId);
        if (count > 0) {
          console.log(`[swapTrigger] Processed swaps for ${count} teams in match ${matchId}`);
          io.to(`match:${matchId}`).emit('swapsProcessed', { matchId });
        }
      } catch (err) {
        console.error(`[swapTrigger] match ${matchId}:`, err.message);
      }
    }
  });

  // ── 3. Match lock trigger — every minute ──────────────────────────────────
  const lockTrigger = cron.schedule('* * * * *', () => {
    const db = getDb();
    const toLock = db.prepare(`
      SELECT id FROM matches
      WHERE status = 'upcoming' AND start_time <= datetime('now')
    `).all();

    if (toLock.length === 0) return;

    const lockTeams = db.prepare(`
      UPDATE user_teams SET locked_at = datetime('now')
      WHERE match_id = ? AND locked_at IS NULL
    `);
    const setLive = db.prepare(`
      UPDATE matches SET status = 'live' WHERE id = ?
    `);

    const lockAll = db.transaction(() => {
      for (const { id } of toLock) {
        lockTeams.run(id);
        setLive.run(id);
        console.log(`[lockTrigger] Match ${id} locked and set live.`);
        io.to(`match:${id}`).emit('matchLocked', { matchId: id });
      }
    });
    lockAll();
  });

  // ── 4. Match reminder — every minute ─────────────────────────────────────
  const reminderJob = cron.schedule('* * * * *', async () => {
    const db = getDb();
    const upcoming = db.prepare(`
      SELECT m.id, m.team_a, m.team_b, m.season_id
      FROM matches m
      WHERE m.status = 'upcoming'
        AND m.start_time BETWEEN datetime('now', '+55 minutes')
                             AND datetime('now', '+65 minutes')
    `).all();

    for (const match of upcoming) {
      const usersWithoutTeam = db.prepare(`
        SELECT u.id, u.name
        FROM season_memberships sm
        JOIN users u ON u.id = sm.user_id
        WHERE sm.season_id = ?
          AND u.id NOT IN (SELECT user_id FROM user_teams WHERE match_id = ?)
      `).all(match.season_id, match.id);

      if (usersWithoutTeam.length > 0) {
        await sendMatchReminders(usersWithoutTeam, match);
      }
    }
  });

  // ── 5. Auto-schedule — every hour ────────────────────────────────────────
  const autoScheduler = cron.schedule('0 * * * *', async () => {
    console.log('[autoScheduler] Running...');
    try { await runAutoSchedule(); }
    catch (err) { console.error('[autoScheduler]', err.message); }
  });

  // Run auto-schedule once on startup
  setImmediate(async () => {
    try { await runAutoSchedule(); }
    catch (err) { console.error('[autoScheduler startup]', err.message); }
  });

  jobs = [livePoller, swapTrigger, lockTrigger, reminderJob, autoScheduler];
  console.log('[cron] All jobs started. Live poller: every 90s, syncs on 3-ball advance.');
}

function stopCronJobs() {
  jobs.forEach(j => j.stop());
  jobs = [];
  matchBallCount.clear();
  console.log('[cron] All jobs stopped.');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract total balls bowled across both innings from match_info response.
 * CricAPI returns score like "145/3 (12.4 ov)" — we parse the overs.
 */
function getMatchBallCount(info) {
  try {
    let totalBalls = 0;
    const scores = info.score || [];
    for (const innings of scores) {
      const overs = parseFloat(innings.o || innings.overs || 0);
      totalBalls += oversToTotalBalls(overs);
    }
    return totalBalls;
  } catch { return 0; }
}

// ── Push notification sender ──────────────────────────────────────────────────

async function sendMatchReminders(users, match) {
  const webpush = require('web-push');
  const db = getDb();

  for (const user of users) {
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(user.id);
    const payload = JSON.stringify({
      type: 'match_reminder',
      title: 'Match starting in 1 hour!',
      body: `${match.team_a} vs ${match.team_b} — submit your team now.`,
      matchId: match.id,
    });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
          payload
        );
        db.prepare("UPDATE push_subscriptions SET last_used_at = datetime('now') WHERE id = ?").run(sub.id);
      } catch (err) {
        if (err.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

module.exports = { startCronJobs, stopCronJobs, sendMatchReminders };
