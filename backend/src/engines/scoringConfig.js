/**
 * SCORING CONFIG
 * Single source of truth for all fantasy point values.
 * All formats (T20, ODI, Test) use the same config.
 * Future: load overrides from DB (SCORING_CONFIG table per season).
 */

const DEFAULT_SCORING_CONFIG = {
  // --- BATTING ---
  batting: {
    playingXiBonus: 4,        // Just for being in the Playing XI
    perRun: 1,
    boundaryBonus: 1,         // Per 4 hit
    sixBonus: 2,              // Per 6 hit
    half_century: 8,          // 50–99 runs
    century: 16,              // 100+ runs
    duck: -2,                 // Dismissed for 0 (batters only — see engine for who qualifies)

    // Strike rate bonuses (min 10 balls faced)
    sr: {
      minBalls: 10,
      tiers: [
        { min: 170,  max: Infinity, points: 6 },
        { min: 150,  max: 170,      points: 4 },
        { min: 130,  max: 150,      points: 2 },
        { min: 70,   max: 130,      points: 0 },  // neutral band
        { min: 60,   max: 70,       points: -2 },
        { min: 0,    max: 60,       points: -4 },
      ],
    },
  },

  // --- BOWLING ---
  bowling: {
    perWicket: 25,
    threeWicketBonus: 4,
    fourWicketBonus: 8,       // cumulative with 3W bonus
    fiveWicketBonus: 16,      // cumulative with 4W bonus
    maiden: 8,                // per maiden over

    // Economy rate bonuses (min 2 overs bowled)
    economy: {
      minOvers: 2,
      tiers: [
        { min: 0,    max: 6,   points: 6 },
        { min: 6,    max: 7,   points: 4 },
        { min: 7,    max: 8,   points: 2 },
        { min: 8,    max: 10,  points: 0 },  // neutral band
        { min: 10,   max: 11,  points: -2 },
        { min: 11,   max: Infinity, points: -4 },
      ],
    },
  },

  // --- FIELDING ---
  fielding: {
    catch: 8,
    stumping: 12,
    runOut: 10,               // flat — API does not distinguish direct/assist
  },

  // --- DISMISSAL BONUSES (credited to bowler) ---
  dismissal: {
    lbwBowledBonus: 8,        // extra points if dismissal is bowled or lbw
  },

  // --- MULTIPLIERS ---
  multipliers: {
    captain: 2.0,
    viceCaptain: 1.5,
  },

  // --- PARTICIPATION ---
  defaultEntryUnits: 300,
};

module.exports = { DEFAULT_SCORING_CONFIG };
