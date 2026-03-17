'use strict';

const cron       = require('node-cron');
const { getDb }  = require('../db/database');
const sportmonks = require('../api/sportmonks');
const { syncLiveMatch, syncPlayingXi, upsertSquad } = require('../api/syncService');

// In-memory ball count tracker to avoid redundant syncs
const matchBallCount = new Map();

function oversToTotalBalls(overs) {
  if (!overs) return 0;
  const o = parseFloat(overs);
  const completed = Math.floor(o);
  const balls     = Math.round((o - completed) * 10);
  return completed * 6 + balls;
}

function startCronJobs(io) {

  // ── 1. Live poller — every 60 seconds ─────────────────────────────────────
  cron.schedule('* * * * *', async () => {
    const db = getDb();
    const liveMatches = db.prepare(
      "SELECT id, sportmonks_fixture_id FROM matches WHERE status = 'live' AND sportmonks_fixture_id IS NOT NULL"
    ).all();

    if (liveMatches.length === 0) return;

    for (const match of liveMatches) {
      try {
        const info = await sportmonks.fetchFixtureInfo(match.sportmonks_fixture_id);

        // Count total balls from score
        const currentBalls = info.score.reduce((sum, s) => sum + oversToTotalBalls(s.o), 0);
        const lastBalls    = matchBallCount.get(match.id) ?? -1;

        if (info.status === 'Finished' || info.status === 'Aban.') {
          // Match ended — do final sync
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
  });

  // ── 2. Live match detector — every minute ──────────────────────────────────
  // Checks Sportmonks livescores to auto-set match status to 'live'
  cron.schedule('* * * * *', async () => {
    const db = getDb();
    try {
      const liveFixtures = await sportmonks.fetchLivescores();
      if (liveFixtures.length === 0) return;

      const liveIds = liveFixtures.map(f => f.sportmonksFixtureId);

      for (const fixtureId of liveIds) {
        const match = db.prepare(
          "SELECT id, status FROM matches WHERE sportmonks_fixture_id = ? AND status = 'upcoming'"
        ).get(fixtureId);

        if (match) {
          db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").run(match.id);
          console.log(`[liveDetector] Match ${match.id} (fixture ${fixtureId}) is now live`);
          io.to(`match:${match.id}`).emit('matchStarted', { matchId: match.id });
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
      AND start_time >= ?
    `).all(twoHours.toISOString(), now.toISOString());

    for (const match of upcoming) {
      try {
        const result = await syncPlayingXi(match.id, match.sportmonks_fixture_id);
        if (result.confirmed && result.count > 0) {
          console.log(`[xiPoller] Match ${match.id}: XI confirmed (${result.count} players)`);
          io.to(`match:${match.id}`).emit('xiConfirmed', { matchId: match.id });
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
