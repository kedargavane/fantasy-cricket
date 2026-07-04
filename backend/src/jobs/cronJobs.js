'use strict';

const cron         = require('node-cron');
const { getDb }    = require('../db/database');
const cricketdata  = require('../api/cricketdata');
const { syncLiveMatch, syncPlayingXi, upsertSquad, recomputeTeamPoints } = require('../api/syncService');

// In-memory trackers
const matchLastStatus  = new Map();
const matchXiNotified  = new Set();


function startCronJobs(io) {

  // ── 1. Live poller — every 30 seconds ──────────────────────────────────────
  // Only polls when there's a live match or one starting within 30 minutes.
  async function pollLiveMatches() {
    const db = getDb();
    const now     = new Date();
    const in30min = new Date(now.getTime() + 30 * 60 * 1000);

    const activeMatches = db.prepare(`
      SELECT id, sportmonks_fixture_id, espn_event_id FROM matches
      WHERE (status = 'live' AND sportmonks_fixture_id LIKE '%-%')
      OR (status = 'upcoming' AND start_time <= ? AND sportmonks_fixture_id LIKE '%-%')
    `).all(in30min.toISOString());

    if (activeMatches.length === 0) return; // Nothing to poll

    for (const match of activeMatches) {
      try {
        // If match has an ESPN event ID, skip CricketData entirely and sync from ESPN.
        // (fetchMatchInfo throws for matches CricketData has no fantasy data for.)
        if (match.espn_event_id) {
          try {
            const { fetchESPNScorecard } = require('../api/espncricinfo');
            const { upsertStats } = require('../api/syncService');
            const matchRow = db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id);

            const { matchInfo, innings } = await fetchESPNScorecard(match.espn_event_id);
            const playerStats = cricketdata.buildPlayerStatsFromScorecard(innings, matchRow.team_a, matchRow.team_b);
            upsertStats(match.id, playerStats);
            recomputeTeamPoints(match.id);

            db.prepare("UPDATE matches SET live_score = ?, last_synced = datetime('now') WHERE id = ?")
              .run(JSON.stringify(matchInfo.score), match.id);

            console.log('[livePoller] ESPN sync match', match.id, '- players:', playerStats.length);

            io.to(`match:${match.id}`).emit('statsUpdate', {
              matchId: match.id, playersUpdated: playerStats.length,
              timestamp: new Date().toISOString(),
            });

            if (matchInfo.trulyFinished) {
              db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").run(match.id);
              io.to(`match:${match.id}`).emit('matchCompleted', { matchId: match.id });

              try {
                const { finaliseMatch } = require('../api/matchService');
                finaliseMatch(match.id);
                console.log(`[livePoller] Match ${match.id} auto-finalised (ESPN)`);
              } catch (e) {
                console.error(`[livePoller] Auto-finalise failed for match ${match.id}:`, e.message);
              }
            }
          } catch (espnErr) {
            console.error('[livePoller] ESPN error match', match.id, ':', espnErr.message);
          }
          continue; // skip CricketData entirely
        }

        const info = await cricketdata.fetchMatchInfo(match.sportmonks_fixture_id);

        // ── Innings break notification ──────────────────────────────────────
        const lastStatus = matchLastStatus.get(match.id);
        if (lastStatus && lastStatus !== info.status) {
          const s = (info.status || '').toLowerCase();
          if (s.includes('innings break') || s.includes('lunch') || s.includes('tea') ||
              s.includes('stumps') || s.includes('drinks')) {
            try {
              const db2     = getDb();
              const matchRow = db2.prepare('SELECT team_a, team_b, season_id, live_score FROM matches WHERE id = ?').get(match.id);
              let scoreText = '';
              try {
                const scores = JSON.parse(matchRow?.live_score || '[]');
                scoreText = scores.map(s => `${s.teamName} ${s.r}/${s.w} (${s.o})`).join(' | ');
              } catch { scoreText = matchRow?.live_score || ''; }

              const webpush = require('web-push');
              const subs = db2.prepare(`
                SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
                JOIN season_memberships sm ON sm.user_id = ps.user_id
                WHERE sm.season_id = ?
              `).all(matchRow.season_id);

              const payload = JSON.stringify({
                title: `🏏 Innings Break — ${matchRow.team_a} vs ${matchRow.team_b}`,
                body:  scoreText || 'Innings over! Check the leaderboard.',
              });
              for (const sub of subs) {
                webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload).catch(() => {});
              }
              console.log(`[notify] Innings break for match ${match.id}: ${subs.length} users`);
            } catch (e) { console.error('[notify] innings break error:', e.message); }
          }
        }
        matchLastStatus.set(match.id, info.status);

        if (info.trulyFinished) {
          console.log(`[livePoller] Match ${match.id} truly finished, final sync...`);
          const result = await syncLiveMatch(match.id, match.sportmonks_fixture_id);
          if (result.success) {
            io.to(`match:${match.id}`).emit('statsUpdate', {
              matchId: match.id, playersUpdated: result.playersUpdated,
              timestamp: new Date().toISOString(),
            });
            io.to(`match:${match.id}`).emit('matchCompleted', { matchId: match.id });

            // Auto-finalise
            try {
              const { finaliseMatch } = require('../api/matchService');
              finaliseMatch(match.id);
              console.log(`[livePoller] Match ${match.id} auto-finalised`);
            } catch (e) {
              console.error(`[livePoller] Auto-finalise failed for match ${match.id}:`, e.message);
            }
          }
          continue;
        }

        if (info.tossInfo) {
          db.prepare('UPDATE matches SET toss_info = ? WHERE id = ?').run(info.tossInfo, match.id);
        }
        if (info.venueInfo) {
          db.prepare('UPDATE matches SET venue_info = ? WHERE id = ?').run(info.venueInfo, match.id);
        }

        // Always sync every 30 seconds — simpler and avoids stale feed issues
        {
          console.log('[livePoller] Match', match.id, 'syncing...');

          const result = await syncLiveMatch(match.id, match.sportmonks_fixture_id);
          if (result.success) {
            io.to(`match:${match.id}`).emit('statsUpdate', {
              matchId: match.id, playersUpdated: result.playersUpdated,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error(`[livePoller] match ${match.id} error:`, err.message);
      }
    }
  }

  setInterval(pollLiveMatches, 30000);
  console.log('[cron] Live poller running every 30s via setInterval');

  // ── 2. Live match detector — every minute ──────────────────────────────────
  // Polls match_info directly for upcoming matches within ±2h of start time.
  // Avoids relying on fetchLivescores() currentMatches feed (has delays).
  cron.schedule('* * * * *', async () => {
    const db = getDb();
    const now        = new Date();
    const twoHours   = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Only run full detection if there's an upcoming match within 2 hours of start_time
    const upcomingSoon = db.prepare(`
      SELECT 1 FROM matches
      WHERE status = 'upcoming'
      AND start_time <= ?
      AND sportmonks_fixture_id LIKE '%-%'
      LIMIT 1
    `).get(twoHours.toISOString());

    if (!upcomingSoon) return; // Nothing to detect

    // Promote upcoming → live by polling match_info directly
    const candidates = db.prepare(`
      SELECT id, sportmonks_fixture_id
      FROM matches
      WHERE status = 'upcoming'
      AND start_time <= ?
      AND start_time >= ?
      AND sportmonks_fixture_id LIKE '%-%'
    `).all(twoHours.toISOString(), twoHoursAgo.toISOString());

    for (const match of candidates) {
      try {
        const info = await cricketdata.fetchMatchInfo(match.sportmonks_fixture_id);
        const hasScore = info.score && info.score.length > 0 && info.score[0].r > 0;

        if (info.matchStarted || hasScore) {
          db.prepare("UPDATE matches SET status = 'live', went_live_at = datetime('now') WHERE id = ?")
            .run(match.id);
          console.log('[liveDetector] Match', match.id, 'is now live');
          io.to(`match:${match.id}`).emit('matchStarted', { matchId: match.id });

          try {
            const { processAutoSwaps } = require('../engines/swapEngine');
            const result = processAutoSwaps(match.id);
            recomputeTeamPoints(match.id);
            console.log(`[liveDetector] Swaps processed for match ${match.id}: ${result.teamsProcessed} teams`);
          } catch (e) {
            console.error('[liveDetector] swap error:', e.message);
          }
        }
      } catch (err) {
        console.error('[liveDetector] match', match.id, 'error:', err.message);
      }
    }

    // Generate 'locked' commentary 2 min after match went live
    const recentlyLocked = db.prepare(`
      SELECT m.id FROM matches m
      WHERE m.status = 'live'
        AND m.went_live_at IS NOT NULL
        AND (strftime('%s','now') - strftime('%s', m.went_live_at)) >= 120
        AND NOT EXISTS (
          SELECT 1 FROM match_commentary mc
          WHERE mc.match_id = m.id AND mc.stage = 'locked'
        )
    `).all();
    for (const m of recentlyLocked) {
      try {
        const { generateCommentary } = require('../api/commentaryService');
        await generateCommentary(m.id, 'locked', '0.0');
      } catch (e) {
        console.error(`[commentary] locked stage failed for match ${m.id}:`, e.message);
      }
    }

    // Revert live → upcoming if match_info confirms not started and no score
    const ourLiveMatches = db.prepare(
      "SELECT id, sportmonks_fixture_id FROM matches WHERE status = 'live' AND sportmonks_fixture_id LIKE '%-%'"
    ).all();

    for (const match of ourLiveMatches) {
      try {
        const info = await cricketdata.fetchMatchInfo(match.sportmonks_fixture_id);
        const hasScore = info.score && info.score.length > 0;
        const lastBalls = db.prepare('SELECT last_ball_count FROM matches WHERE id = ?').get(match.id);
        if (!info.matchStarted && !hasScore && lastBalls.last_ball_count === 0) {
          db.prepare("UPDATE matches SET status = 'upcoming' WHERE id = ?").run(match.id);
          console.log('[liveDetector] Match', match.id, 'reverted to upcoming');
        }
      } catch (err) {
        console.error('[liveDetector] revert check error:', err.message);
      }
    }
  });

  // ── 3. Playing XI poller — every 2 minutes ─────────────────────────────────
  // CricketData exposes the squad via hasSquad on match_info.
  // We poll upcoming matches starting within 1 hour; when hasSquad is true,
  // fetch the squad and mark all returned players as playing XI.
  cron.schedule('*/2 * * * *', async () => {
    const db  = getDb();
    const now            = new Date();
    const twentyFourHours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = db.prepare(`
      SELECT id, sportmonks_fixture_id, team_a, team_b
      FROM matches
      WHERE status = 'upcoming'
      AND sportmonks_fixture_id IS NOT NULL
      AND start_time <= ?
    `).all(twentyFourHours.toISOString());

    for (const match of upcoming) {
      try {
        const externalId = match.sportmonks_fixture_id;
        // Skip old Sportmonks numeric IDs — CricketData IDs are UUIDs
        if (!externalId || !String(externalId).includes('-')) {
          console.log('[xiPoller] Skipping match', match.id, '— not a CricketData UUID');
          continue;
        }

        const info = await cricketdata.fetchMatchInfo(externalId);
        if (!info.hasSquad) continue;

        // Squad announced — sync it and mark all as playing XI
        const result = await syncPlayingXi(match.id, match.sportmonks_fixture_id);
        if (result.confirmed && result.count > 0) {
          console.log(`[xiPoller] Match ${match.id}: XI confirmed (${result.count} players)`);
          io.to(`match:${match.id}`).emit('xiConfirmed', { matchId: match.id });

          if (!matchXiNotified.has(match.id)) {
            matchXiNotified.add(match.id);
            try {
              const webpush  = require('web-push');
              const db2      = getDb();
              const matchRow = db2.prepare('SELECT team_a, team_b, season_id, start_time FROM matches WHERE id = ?').get(match.id);
              const subs     = db2.prepare(`
                SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
                JOIN season_memberships sm ON sm.user_id = ps.user_id
                WHERE sm.season_id = ?
              `).all(matchRow.season_id);
              const startTime = new Date(matchRow.start_time).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
              });
              const payload = JSON.stringify({
                title: `🏏 Playing XI Announced!`,
                body:  `${matchRow.team_a} vs ${matchRow.team_b} — Update your team before ${startTime} IST`,
              });
              for (const sub of subs) {
                webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload).catch(() => {});
              }
              console.log(`[notify] XI confirmed for match ${match.id}: ${subs.length} users`);
            } catch (e) { console.error('[notify] XI error:', e.message); }
          }
        }
      } catch (err) {
        console.error(`[xiPoller] match ${match.id} error:`, err.message);
      }
    }
  });

  // ── 4. Squad sync — every hour ─────────────────────────────────────────────
  // CricketData uses match UUID directly — no season/team IDs needed.
  cron.schedule('0 * * * *', async () => {
    const db            = getDb();
    const twentyFourHours = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const matches = db.prepare(`
      SELECT m.id, m.sportmonks_fixture_id, m.team_a, m.team_b
      FROM matches m
      WHERE m.status = 'upcoming'
      AND m.sportmonks_fixture_id IS NOT NULL
      AND m.start_time <= ?
      AND (SELECT COUNT(*) FROM match_squads ms WHERE ms.match_id = m.id) = 0
    `).all(twentyFourHours);

    if (matches.length === 0) return;
    console.log(`[squadSync] Syncing squads for ${matches.length} matches...`);

    for (const match of matches) {
      try {
        const players = await cricketdata.fetchMatchSquad(match.sportmonks_fixture_id);
        if (players.length > 0) {
          upsertSquad(match.id, players);
          console.log(`[squadSync] Match ${match.id}: ${players.length} players synced`);
        } else {
          console.log(`[squadSync] Match ${match.id}: no squad available yet`);
        }
      } catch (err) {
        console.error(`[squadSync] Match ${match.id} error:`, err.message);
      }
    }
  });

  // ── 5. Match reminder — every minute ───────────────────────────────────────
  cron.schedule('* * * * *', async () => {
    const db  = getDb();
    const now   = new Date();
    const in30m = new Date(now.getTime() + 30 * 60 * 1000);
    const in31m = new Date(now.getTime() + 31 * 60 * 1000);

    const soon = db.prepare(`
      SELECT m.id, m.team_a, m.team_b, m.start_time, m.season_id
      FROM matches m
      WHERE m.status = 'upcoming'
      AND m.start_time BETWEEN ? AND ?
    `).all(in30m.toISOString(), in31m.toISOString());

    for (const match of soon) {
      try {
        io.emit('matchReminder', {
          matchId:  match.id,
          teamA:    match.team_a,
          teamB:    match.team_b,
          startsIn: 30,
        });
      } catch {}
    }
  });

  console.log('[cron] All jobs started (CricketData)');
}

module.exports = { startCronJobs };
