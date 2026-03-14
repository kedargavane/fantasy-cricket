'use strict';

/**
 * AUTO-SCHEDULE SERVICE
 *
 * Automatically discovers and creates matches from CricAPI
 * for all active seasons that have a series_id configured.
 *
 * How it works:
 *  1. Every hour, fetches the upcoming match list from CricAPI
 *  2. For each active season, filters matches by the configured
 *     series IDs (e.g. IPL 2026 series ID)
 *  3. Upserts any new matches into the DB automatically
 *  4. Also pulls squad data for matches starting within 48 hours
 *  5. Admin can still override any match details manually
 *
 * Series IDs are stored in the seasons table (series_ids JSON field).
 * Admin adds them once per season via the admin dashboard.
 */

const { getDb }       = require('../db/database');
const cricapi         = require('./cricapi');
const { upsertMatch, upsertSquad } = require('./syncService');

// ── Main auto-schedule function ───────────────────────────────────────────────

async function runAutoSchedule() {
  const db = getDb();

  // Get all active seasons that have series IDs configured
  const seasons = db.prepare(`
    SELECT id, name, series_ids FROM seasons
    WHERE status IN ('upcoming', 'active')
      AND series_ids IS NOT NULL
      AND series_ids != '[]'
      AND series_ids != ''
  `).all();

  if (seasons.length === 0) {
    console.log('[autoSchedule] No seasons with series IDs configured.');
    return;
  }

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSquadsSynced = 0;

  for (const season of seasons) {
    let seriesIds;
    try {
      seriesIds = JSON.parse(season.series_ids);
    } catch {
      console.warn(`[autoSchedule] Invalid series_ids for season ${season.id}`);
      continue;
    }

    console.log(`[autoSchedule] Processing season "${season.name}" with ${seriesIds.length} series`);

    for (const seriesId of seriesIds) {
      try {
        const matches = await fetchMatchesForSeries(seriesId);

        for (const matchData of matches) {
          const result = upsertMatchSafe(db, season.id, matchData);
          if (result.created) totalCreated++;
          if (result.updated) totalUpdated++;
        }

        // Auto-sync squads for matches starting within 48 hours
        const upcoming = db.prepare(`
          SELECT id, external_match_id FROM matches
          WHERE season_id = ?
            AND status = 'upcoming'
            AND start_time <= datetime('now', '+48 hours')
            AND start_time > datetime('now')
        `).all(season.id);

        for (const match of upcoming) {
          const synced = await syncSquadSafe(match.id, match.external_match_id);
          if (synced) totalSquadsSynced++;
        }

      } catch (err) {
        console.error(`[autoSchedule] Series ${seriesId} error:`, err.message);
      }
    }
  }

  console.log(`[autoSchedule] Done — created:${totalCreated} updated:${totalUpdated} squads:${totalSquadsSynced}`);
  return { totalCreated, totalUpdated, totalSquadsSynced };
}

// ── Fetch matches from a series ───────────────────────────────────────────────

async function fetchMatchesForSeries(seriesId) {
  const data = await cricapi.cricGetPublic('series_info', { id: seriesId });
  const matchList = data?.data?.matchList || [];

  return matchList.map(m => ({
    externalMatchId: m.id,
    teamA:      m.teams?.[0] || 'TBC',
    teamB:      m.teams?.[1] || 'TBC',
    venue:      m.venue || '',
    matchType:  normaliseMatchType(m.matchType),
    status:     normaliseStatus(m.matchStarted, m.matchEnded),
    startTime:  m.dateTimeGMT || m.date || '',
    seriesId,
  })).filter(m => m.externalMatchId && m.startTime);
}

// ── Safe upsert — won't throw, returns created/updated flags ─────────────────

function upsertMatchSafe(db, seasonId, matchData) {
  try {
    const existing = db.prepare(
      'SELECT id, status FROM matches WHERE external_match_id = ?'
    ).get(matchData.externalMatchId);

    if (existing) {
      // Only update status if it has changed
      if (existing.status !== matchData.status) {
        db.prepare('UPDATE matches SET status = ?, last_synced = datetime(\'now\') WHERE id = ?')
          .run(matchData.status, existing.id);
        return { created: false, updated: true };
      }
      return { created: false, updated: false };
    }

    // New match — insert
    upsertMatch(seasonId, matchData);
    console.log(`[autoSchedule] Created match: ${matchData.teamA} vs ${matchData.teamB} (${matchData.startTime})`);
    return { created: true, updated: false };

  } catch (err) {
    console.error('[autoSchedule] upsertMatchSafe error:', err.message);
    return { created: false, updated: false };
  }
}

// ── Safe squad sync ───────────────────────────────────────────────────────────

async function syncSquadSafe(matchId, externalMatchId) {
  try {
    const db = getDb();

    // Check if we already have a squad (don't hammer the API)
    const existingCount = db.prepare(
      'SELECT COUNT(*) as count FROM match_squads WHERE match_id = ?'
    ).get(matchId).count;

    // Re-sync if we have fewer than 11 players or no XI confirmed yet
    const xiCount = db.prepare(
      'SELECT COUNT(*) as count FROM match_squads WHERE match_id = ? AND is_playing_xi = 1'
    ).get(matchId).count;

    if (existingCount >= 22 && xiCount >= 11) {
      return false; // Already have full squad with XI
    }

    const players = await cricapi.fetchMatchSquad(externalMatchId);
    if (players.length > 0) {
      upsertSquad(matchId, players);
      console.log(`[autoSchedule] Synced ${players.length} players for match ${matchId}`);
      return true;
    }
    return false;
  } catch (err) {
    // Squad not available yet — normal before match day
    return false;
  }
}

// ── Normalisers (duplicated here to keep module self-contained) ───────────────

function normaliseMatchType(type) {
  if (!type) return 't20';
  const t = type.toLowerCase();
  if (t.includes('test')) return 'test';
  if (t.includes('odi') || t.includes('one day')) return 'odi';
  return 't20';
}

function normaliseStatus(matchStarted, matchEnded) {
  if (matchEnded)   return 'completed';
  if (matchStarted) return 'live';
  return 'upcoming';
}

module.exports = { runAutoSchedule, fetchMatchesForSeries };
