'use strict';

const cron       = require('node-cron');
const { getDb }  = require('../db/database');
const sportmonks = require('../api/sportmonks');
const { syncLiveMatch, syncPlayingXi, upsertSquad } = require('../api/syncService');

// In-memory trackers
const matchBallCount   = new Map();
const matchLastStatus  = new Map(); // track innings changes for notifications
const matchXiNotified  = new Set(); // track if XI notification sent

function oversToTotalBalls(overs) {
  if (!overs) return 0;
  const o = parseFloat(overs);
  const completed = Math.floor(o);
  const balls     = Math.round((o - completed) * 10);
  return completed * 6 + balls;
}

function startCronJobs(io) {

  // ── 1. Live poller — every 30 seconds (two staggered cron jobs) ────────────
  async function pollLiveMatches() {
    const db = getDb();
    const liveMatches = db.prepare(
      "SELECT id, sportmonks_fixture_id FROM matches WHERE status = 'live' AND sportmonks_fixture_id IS NOT NULL"
    ).all();

    if (liveMatches.length === 0) return;

    for (const match of liveMatches) {
      try {
        const info = await sportmonks.fetchFixtureInfo(match.sportmonks_fixture_id);

        // Count total balls from score
        const currentBalls = info.score.reduce((sum, s) => sum + oversToTotalBalls(s.overs), 0);
        const lastBalls    = matchBallCount.get(match.id) ?? -1;

        // ── Innings break notification ──────────────────────────────────────
        const lastStatus = matchLastStatus.get(match.id);
        if (lastStatus && lastStatus !== info.status) {
          if (info.status === 'Innings Break' || info.status === 'Lunch' || info.status === 'Tea') {
            try {
              const db2 = getDb();
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
                body: scoreText || 'Innings over! Check the leaderboard.',
              });
              for (const sub of subs) {
                webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload).catch(() => {});
              }
              console.log(`[notify] Innings break for match ${match.id}: ${subs.length} users`);
            } catch (e) { console.error('[notify] innings break error:', e.message); }
          }
        }
        matchLastStatus.set(match.id, info.status);

        if (info.status === 'Finished' || info.status === 'Aban.') {
          console.log(`[livePoller] Match ${match.id} ended, final sync...`);
          const result = await syncLiveMatch(match.id, match.sportmonks_fixture_id);
          if (result.success) {
            matchBallCount.delete(match.id);
            io.to(`match:${match.id}`).emit('statsUpdate', {
              matchId: match.id, playersUpdated: result.playersUpdated,
              timestamp: new Date().toISOString(),
            });
            io.to(`match:${match.id}`).emit('matchCompleted', { matchId: match.id });
          }
          continue;
        }

        if (currentBalls > lastBalls) {
          console.log(`[livePoller] Match ${match.id}: ball ${lastBalls}→${currentBalls}, syncing...`);
          matchBallCount.set(match.id, currentBalls);
          db.prepare('UPDATE matches SET last_ball_count = ? WHERE id = ?').run(currentBalls, match.id);

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
  // Poll every 30 seconds using setInterval (Sportmonks is pull-only, no webhooks)
  setInterval(pollLiveMatches, 30000);
  console.log('[cron] Live poller running every 30s via setInterval');

  // ── 2. Live match detector — every minute ──────────────────────────────────
  // Checks Sportmonks livescores to auto-set match status to 'live'
  // Also reverts 'live' back to 'upcoming' if Sportmonks reports Delayed/NS
  cron.schedule('* * * * *', async () => {
    const db = getDb();
    try {
      const liveFixtures = await sportmonks.fetchLivescores();
      const liveFixtureMap = new Map(liveFixtures.map(f => [f.sportmonksFixtureId, f]));

      // Set upcoming → live for fixtures now live on Sportmonks
      // Sportmonks uses: 'Live', '1st Innings', '2nd Innings', '3rd Innings', '4th Innings', 'Innings Break'
      const LIVE_STATUSES = new Set(['Live', '1st Innings', '2nd Innings', '3rd Innings', '4th Innings', 'Innings Break', 'Lunch', 'Tea', 'Stumps', 'Int.']);
      for (const [fixtureId, fixture] of liveFixtureMap) {
        if (!LIVE_STATUSES.has(fixture.status)) continue;
        const match = db.prepare(
          "SELECT id FROM matches WHERE sportmonks_fixture_id = ? AND status = 'upcoming'"
        ).get(fixtureId);
        if (match) {
          db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").run(match.id);
          console.log(`[liveDetector] Match ${match.id} (fixture ${fixtureId}) is now live (${fixture.status})`);
          io.to(`match:${match.id}`).emit('matchStarted', { matchId: match.id });
        }
      }

      // Revert live → upcoming if Sportmonks reports Delayed/NS/Postponed
      const ourLiveMatches = db.prepare(
        "SELECT id, sportmonks_fixture_id FROM matches WHERE status = 'live' AND sportmonks_fixture_id IS NOT NULL"
      ).all();

      for (const match of ourLiveMatches) {
        const fixture = liveFixtureMap.get(match.sportmonks_fixture_id);
        // If not in livescores at all, or status is Delayed/NS/Postp
        const smStatus = fixture?.status || '';
        if (!fixture || smStatus === 'Delayed' || smStatus === 'NS' || smStatus === 'Postp.') {
          // Double-check with fixture endpoint before reverting
          try {
            const info = await sportmonks.fetchFixtureInfo(match.sportmonks_fixture_id);
            if (info.status === 'Delayed' || info.status === 'NS' || info.status === 'Postp.') {
              db.prepare("UPDATE matches SET status = 'upcoming' WHERE id = ?").run(match.id);
              console.log(`[liveDetector] Match ${match.id} reverted to upcoming (${info.status})`);
              io.to(`match:${match.id}`).emit('matchDelayed', { matchId: match.id });
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error('[liveDetector] error:', err.message);
    }
  });

  // ── 3. Playing XI poller — every 5 minutes ─────────────────────────────────
  // Polls lineup for matches starting within 2 hours
  cron.schedule('*/5 * * * *', async () => {
    const db = getDb();
    const now      = new Date();
    const twoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const upcoming = db.prepare(`
      SELECT id, sportmonks_fixture_id, team_a, team_b
      FROM matches
      WHERE status = 'upcoming'
      AND sportmonks_fixture_id IS NOT NULL
      AND start_time <= ?
    `).all(twoHours.toISOString());

    for (const match of upcoming) {
      try {
        const result = await syncPlayingXi(match.id, match.sportmonks_fixture_id);
        if (result.confirmed && result.count > 0) {
          console.log(`[xiPoller] Match ${match.id}: XI confirmed (${result.count} players)`);
          io.to(`match:${match.id}`).emit('xiConfirmed', { matchId: match.id });
          
          // Send XI notification if not already sent
          if (!matchXiNotified.has(match.id)) {
            matchXiNotified.add(match.id);
            try {
              const webpush = require('web-push');
              const db2 = getDb();
              const matchRow = db2.prepare('SELECT team_a, team_b, season_id, start_time FROM matches WHERE id = ?').get(match.id);
              const subs = db2.prepare(`
                SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
                JOIN season_memberships sm ON sm.user_id = ps.user_id
                WHERE sm.season_id = ?
              `).all(matchRow.season_id);
              const startTime = new Date(matchRow.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
              const payload = JSON.stringify({
                title: `🏏 Playing XI Announced!`,
                body: `${matchRow.team_a} vs ${matchRow.team_b} — Update your team before ${startTime} IST`,
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
  // Syncs squads for upcoming matches with 0 players using team/season squad endpoint
  cron.schedule('0 * * * *', async () => {
    const db = getDb();
    const matches = db.prepare(`
      SELECT m.id, m.sportmonks_fixture_id, m.sportmonks_season_id,
             m.localteam_id, m.visitorteam_id, m.team_a, m.team_b
      FROM matches m
      WHERE m.status = 'upcoming'
      AND m.sportmonks_fixture_id IS NOT NULL
      AND (SELECT COUNT(*) FROM match_squads ms WHERE ms.match_id = m.id) = 0
    `).all();

    if (matches.length === 0) return;
    console.log(`[squadSync] Syncing squads for ${matches.length} matches...`);

    for (const match of matches) {
      try {
        let localteamId   = match.localteam_id;
        let visitorteamId = match.visitorteam_id;
        let smSeasonId    = match.sportmonks_season_id;

        // Fetch team IDs from Sportmonks if missing
        if (!localteamId || !visitorteamId || !smSeasonId) {
          const axios = require('axios');
          const fr = await axios.get(
            `https://cricket.sportmonks.com/api/v2.0/fixtures/${match.sportmonks_fixture_id}`,
            { params: { api_token: process.env.SPORTMONKS_TOKEN }, timeout: 15000 }
          );
          const f = fr.data?.data || {};
          localteamId   = f.localteam_id;
          visitorteamId = f.visitorteam_id;
          smSeasonId    = f.season_id;
          db.prepare('UPDATE matches SET localteam_id=?, visitorteam_id=?, sportmonks_season_id=? WHERE id=?')
            .run(localteamId, visitorteamId, smSeasonId, match.id);
        }

        if (!localteamId || !visitorteamId || !smSeasonId) {
          console.log(`[squadSync] Match ${match.id}: could not resolve team IDs, skipping`);
          continue;
        }

        const allPlayers = [];

        // Fetch squad for both teams
        for (const [teamId, teamName] of [
          [localteamId, match.team_a],
          [visitorteamId, match.team_b],
        ]) {
          try {
            const squad = await sportmonks.fetchSquadByTeamAndSeason(teamId, smSeasonId);
            for (const p of squad) {
              allPlayers.push({ ...p, team: teamName });
            }
            console.log(`[squadSync] Match ${match.id}: ${squad.length} players for ${teamName}`);
          } catch (err) {
            console.error(`[squadSync] Match ${match.id} team ${teamId} error:`, err.message);
          }
        }

        if (allPlayers.length > 0) {
          upsertSquad(match.id, allPlayers);
          console.log(`[squadSync] Match ${match.id}: total ${allPlayers.length} players synced`);
        }
      } catch (err) {
        console.error(`[squadSync] Match ${match.id} error:`, err.message);
      }
    }
  });

  // ── 5. Match reminder — every minute ───────────────────────────────────────
  cron.schedule('* * * * *', async () => {
    const db = getDb();
    const now    = new Date();
    const in30m  = new Date(now.getTime() + 30 * 60 * 1000);
    const in31m  = new Date(now.getTime() + 31 * 60 * 1000);

    const soon = db.prepare(`
      SELECT m.id, m.team_a, m.team_b, m.start_time, m.season_id
      FROM matches m
      WHERE m.status = 'upcoming'
      AND m.start_time BETWEEN ? AND ?
    `).all(in30m.toISOString(), in31m.toISOString());

    for (const match of soon) {
      try {
        const members = db.prepare(`
          SELECT u.id FROM season_memberships sm
          JOIN users u ON u.id = sm.user_id
          WHERE sm.season_id = ?
        `).all(match.season_id);
        io.emit('matchReminder', {
          matchId:  match.id,
          teamA:    match.team_a,
          teamB:    match.team_b,
          startsIn: 30,
        });
      } catch {}
    }
  });

  console.log('[cron] All jobs started (Sportmonks)');
}

module.exports = { startCronJobs };
