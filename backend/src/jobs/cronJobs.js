'use strict';

const cron = require('node-cron');
const { getDb }          = require('../db/database');
const { syncLiveMatch, processAutoSwaps } = require('../api/syncService');
const { fetchMatchInfo } = require('../api/cricapi');
const { runAutoSchedule } = require('../api/autoSchedule');

let jobs = [];

/**
 * POLLING STRATEGY — S plan (2,000 calls/day)
 *
 * Per live match we make two types of API calls:
 *  - "check" call  : match_info — cheap, returns current ball count
 *  - "sync" call   : match_scorecard — full stats, triggers recompute
 *
 * We check every 60 seconds. We sync every time a new ball is bowled.
 * This gives ~1 minute lag between a ball being bowled and scores updating.
 *
 * Call budget:
 *  T20  single match : ~460 calls
 *  ODI  single match : ~1,060 calls
 *  IPL  double-header: ~930 calls (2 T20s)
 *  All well within 2,000/day limit.
 *
 * Ball count is tracked in-memory. Server restart forces immediate sync.
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

  // ── 1. Smart live poller — every 60 seconds ───────────────────────────────
  // Checks ball count cheaply, syncs full scorecard on every new ball
  const livePoller = cron.schedule('* * * * *', async () => {
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
        const lastBalls    = matchBallCount.get(match.id) ?? -1; // force first sync

        if (currentBalls > lastBalls) {
          // New ball bowled — do full scorecard fetch
          console.log(`[livePoller] Match ${match.id}: ball ${lastBalls}→${currentBalls}, syncing...`);
          // Always advance ball count so poller doesn't retry same balls if scorecard fails
          matchBallCount.set(match.id, currentBalls);
          db.prepare('UPDATE matches SET last_ball_count = ? WHERE id = ?').run(currentBalls, match.id);

          const result = await syncLiveMatch(match.id, match.external_match_id);

          if (result.success) {
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

  // ── 2. Playing XI poller — every 5 minutes ──────────────────────────────
  // Polls match_xi for upcoming matches within 2 hours of start
  // Once XI confirmed, triggers auto-swaps and locks team selection
  cron.schedule('*/5 * * * *', async () => {
    const db = getDb();
    const now = new Date();

    // Find upcoming matches starting within next 2 hours
    const upcomingMatches = db.prepare(`
      SELECT id, external_match_id, start_time
      FROM matches
      WHERE status = 'upcoming'
      AND start_time IS NOT NULL
      AND datetime(start_time) <= datetime('now', '+2 hours')
      AND datetime(start_time) >= datetime('now', '-30 minutes')
    `).all();

    for (const match of upcomingMatches) {
      try {
        const { syncPlayingXi } = require('../api/syncService');
        const result = await syncPlayingXi(match.id, match.external_match_id);

        if (result.success && result.xiCount === 22) {
          // XI confirmed for both teams — lock match and trigger swaps
          db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").run(match.id);
          const { processAutoSwaps } = require('../api/syncService');
          processAutoSwaps(match.id);
          console.log(`[xiPoller] Match ${match.id}: XI confirmed, match locked, swaps processed`);

          // Notify connected clients
          io.to(`match:${match.id}`).emit('xiConfirmed', { matchId: match.id });
        } else if (result.success) {
          console.log(`[xiPoller] Match ${match.id}: ${result.xiCount} players confirmed (waiting for full XI)`);
        }
      } catch (err) {
        console.error(`[xiPoller] Match ${match.id} error:`, err.message);
      }
    }
  });

  // ── 3. Auto-swap trigger — every 60 seconds ───────────────────────────────
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

  // ── 5. Auto squad sync — every hour ─────────────────────────────────────
  // Syncs squads for upcoming matches that have 0 players loaded
  cron.schedule('0 * * * *', async () => {
    const db = getDb();
    const matchesNeedingSquad = db.prepare(`
      SELECT m.id, m.external_match_id, m.team_a, m.team_b
      FROM matches m
      WHERE m.status = 'upcoming'
      AND m.external_match_id IS NOT NULL
      AND m.external_match_id NOT LIKE 'manual-%'
      AND (SELECT COUNT(*) FROM match_squads ms WHERE ms.match_id = m.id) = 0
    `).all();

    if (matchesNeedingSquad.length === 0) return;
    console.log(`[squadSync] ${matchesNeedingSquad.length} matches need squads`);

    const { fetchMatchSquad } = require('../api/cricapi');
    const { upsertSquad }     = require('../api/syncService');

    for (const match of matchesNeedingSquad) {
      try {
        const players = await fetchMatchSquad(match.external_match_id);
        if (players.length > 0) {
          upsertSquad(match.id, players);
          console.log(`[squadSync] Match ${match.id}: ${players.length} players synced`);
        }
      } catch (err) {
        console.error(`[squadSync] Match ${match.id} error:`, err.message);
      }
    }
  });

  // ── 6. Auto-schedule — every hour ────────────────────────────────────────
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
