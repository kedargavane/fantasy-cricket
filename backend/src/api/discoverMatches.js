'use strict';

/**
 * GET /api/admin/discover
 * Fetches upcoming matches from CricAPI and marks which ones
 * are already added to the current season.
 *
 * Query params:
 *  - seasonId  (required)
 *  - offset    (default 0, for pagination)
 *  - type      (optional: t20 | odi | test)
 */

const axios = require('axios');

async function discoverMatches(req, res, db) {
  const { seasonId, offset = 0, type } = req.query;

  if (!seasonId) return res.status(400).json({ error: 'seasonId required' });

  const apiKey = process.env.CRICAPI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CRICAPI_KEY not configured' });

  // Fetch upcoming matches from CricAPI
  let cricMatches = [];
  try {
    const response = await axios.get('https://api.cricapi.com/v1/matches', {
      params: { apikey: apiKey, offset },
      timeout: 10000,
    });

    if (response.data?.status !== 'success') {
      return res.status(502).json({ error: 'CricAPI error: ' + (response.data?.reason || 'unknown') });
    }

    cricMatches = response.data?.data || [];
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach CricAPI: ' + err.message });
  }

  // Get all external match IDs already in this season
  const existingIds = new Set(
    db.prepare('SELECT external_match_id FROM matches WHERE season_id = ?')
      .all(seasonId)
      .map(r => r.external_match_id)
  );

  // Normalise and filter
  const matches = cricMatches
    .filter(m => {
      // Only upcoming/live international matches
      if (!m.id || !m.teams || m.teams.length < 2) return false;
      if (m.matchEnded) return false;
      // Filter by type if specified
      if (type) {
        const mt = (m.matchType || '').toLowerCase();
        if (type === 't20' && !mt.includes('t20')) return false;
        if (type === 'odi' && !mt.includes('odi')) return false;
        if (type === 'test' && !mt.includes('test')) return false;
      }
      return true;
    })
    .map(m => ({
      externalMatchId: m.id,
      name:            m.name || `${m.teams[0]} vs ${m.teams[1]}`,
      teamA:           m.teams[0] || '',
      teamB:           m.teams[1] || '',
      venue:           m.venue || '',
      matchType:       normaliseMatchType(m.matchType),
      startTime:       m.dateTimeGMT || m.date || '',
      status:          m.matchStarted ? 'live' : 'upcoming',
      seriesName:      m.series || m.name || '',
      alreadyAdded:    existingIds.has(m.id),
    }));

  return res.json({
    matches,
    total: matches.length,
    offset: parseInt(offset),
  });
}

function normaliseMatchType(type) {
  if (!type) return 't20';
  const t = type.toLowerCase();
  if (t.includes('test')) return 'test';
  if (t.includes('odi') || t.includes('one day')) return 'odi';
  return 't20';
}

module.exports = { discoverMatches };
