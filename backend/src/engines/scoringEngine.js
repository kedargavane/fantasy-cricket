'use strict';

const { DEFAULT_SCORING_CONFIG } = require('./scoringConfig');

/**
 * Calculate fantasy points for a single player in a single match.
 *
 * @param {object} stats - Player match stats from DB / API
 * @param {string} stats.dismissalType   - 'bowled'|'lbw'|'caught'|'runout'|'stumped'|'notout'|'dnb'
 * @param {number} stats.runs
 * @param {number} stats.ballsFaced
 * @param {number} stats.fours
 * @param {number} stats.sixes
 * @param {number} stats.oversBowled      - e.g. 3.4 means 3 overs 4 balls
 * @param {number} stats.wickets
 * @param {number} stats.runsConceded
 * @param {number} stats.maidens
 * @param {number} stats.catches
 * @param {number} stats.stumpings
 * @param {number} stats.runOuts
 * @param {boolean} stats.isPlayingXi     - true if confirmed in Playing XI
 * @param {string}  role                  - 'captain'|'vice_captain'|'normal'
 * @param {object}  config                - scoring config (defaults to DEFAULT_SCORING_CONFIG)
 *
 * @returns {object} { total, breakdown }
 */
function calculateFantasyPoints(stats, role = 'normal', config = DEFAULT_SCORING_CONFIG) {
  const breakdown = {};
  let total = 0;

  // ── Playing XI bonus ─────────────────────────────────────────────────────
  if (stats.isPlayingXi) {
    breakdown.playingXiBonus = config.batting.playingXiBonus;
    total += breakdown.playingXiBonus;
  } else {
    // Player not in XI — no points at all
    return { total: 0, breakdown: { notPlaying: true } };
  }

  // ── BATTING ──────────────────────────────────────────────────────────────
  const runs       = stats.runs        ?? 0;
  const balls      = stats.ballsFaced  ?? 0;
  const fours      = stats.fours       ?? 0;
  const sixes      = stats.sixes       ?? 0;
  const dismissed  = stats.dismissalType && stats.dismissalType !== 'notout' && stats.dismissalType !== 'dnb';

  // Per run
  if (runs > 0) {
    breakdown.runs = runs * config.batting.perRun;
    total += breakdown.runs;
  }

  // Boundary bonus
  if (fours > 0) {
    breakdown.boundaryBonus = fours * config.batting.boundaryBonus;
    total += breakdown.boundaryBonus;
  }

  // Six bonus
  if (sixes > 0) {
    breakdown.sixBonus = sixes * config.batting.sixBonus;
    total += breakdown.sixBonus;
  }

  // Milestone bonus (mutually exclusive — only highest applies)
  if (runs >= 100) {
    breakdown.centuryBonus = config.batting.century;
    total += breakdown.centuryBonus;
  } else if (runs >= 50) {
    breakdown.halfCenturyBonus = config.batting.half_century;
    total += breakdown.halfCenturyBonus;
  }

  // Duck penalty — only if dismissed AND scored 0
  if (dismissed && runs === 0) {
    breakdown.duckPenalty = config.batting.duck;
    total += breakdown.duckPenalty;
  }

  // Strike rate bonus/penalty (min balls applies)
  if (balls >= config.batting.sr.minBalls) {
    const sr = (runs / balls) * 100;
    const srPoints = getSrPoints(sr, config.batting.sr.tiers);
    if (srPoints !== 0) {
      breakdown.strikeRatePoints = srPoints;
      total += srPoints;
    }
  }

  // ── BOWLING ──────────────────────────────────────────────────────────────
  const wickets       = stats.wickets       ?? 0;
  const runsConceded  = stats.runsConceded  ?? 0;
  const maidens       = stats.maidens       ?? 0;
  const oversBowled   = stats.oversBowled   ?? 0;
  const totalBalls    = oversToTotalBalls(oversBowled);

  if (totalBalls > 0) {
    // Per wicket
    if (wickets > 0) {
      breakdown.wicketPoints = wickets * config.bowling.perWicket;
      total += breakdown.wicketPoints;
    }

    // Wicket haul bonuses (cumulative)
    if (wickets >= 5) {
      breakdown.wicketHaulBonus =
        config.bowling.threeWicketBonus +
        config.bowling.fourWicketBonus +
        config.bowling.fiveWicketBonus;
      total += breakdown.wicketHaulBonus;
    } else if (wickets >= 4) {
      breakdown.wicketHaulBonus =
        config.bowling.threeWicketBonus +
        config.bowling.fourWicketBonus;
      total += breakdown.wicketHaulBonus;
    } else if (wickets >= 3) {
      breakdown.wicketHaulBonus = config.bowling.threeWicketBonus;
      total += breakdown.wicketHaulBonus;
    }

    // Maidens
    if (maidens > 0) {
      breakdown.maidenPoints = maidens * config.bowling.maiden;
      total += breakdown.maidenPoints;
    }

    // Economy rate (min overs)
    const completedOvers = Math.floor(oversBowled);
    const fractionalBalls = Math.round((oversBowled - completedOvers) * 10);
    const oversForEconomy = completedOvers + fractionalBalls / 6;

    if (oversForEconomy >= config.bowling.economy.minOvers) {
      const economy = runsConceded / oversForEconomy;
      const econPoints = getEconomyPoints(economy, config.bowling.economy.tiers);
      if (econPoints !== 0) {
        breakdown.economyPoints = econPoints;
        total += econPoints;
      }
    }
  }

  // ── DISMISSAL BONUS (LBW / Bowled) ───────────────────────────────────────
  // Credited to the bowler — but in our model stats belong to the batsman.
  // The engine credits this to the BOWLING player whose dismissalType is
  // provided via the bowler's stats object (see note in API integration).
  // Here we handle it when dismissalType is passed on the batsman stats
  // and is read by the bowler's scoring call. To keep this engine pure and
  // stateless, we accept an optional `bowlerDismissalType` field.
  if (stats.bowlerDismissalType === 'bowled' || stats.bowlerDismissalType === 'lbw') {
    breakdown.lbwBowledBonus = config.dismissal.lbwBowledBonus;
    total += breakdown.lbwBowledBonus;
  }

  // ── FIELDING ─────────────────────────────────────────────────────────────
  const catches   = stats.catches   ?? 0;
  const stumpings = stats.stumpings ?? 0;
  const runOuts   = stats.runOuts   ?? 0;

  if (catches > 0) {
    breakdown.catchPoints = catches * config.fielding.catch;
    total += breakdown.catchPoints;
  }
  if (stumpings > 0) {
    breakdown.stumpingPoints = stumpings * config.fielding.stumping;
    total += breakdown.stumpingPoints;
  }
  if (runOuts > 0) {
    breakdown.runOutPoints = runOuts * config.fielding.runOut;
    total += breakdown.runOutPoints;
  }

  // ── CAPTAIN / VICE-CAPTAIN MULTIPLIER ────────────────────────────────────
  const baseTotal = total;
  if (role === 'captain') {
    total = Math.round(total * config.multipliers.captain);
    breakdown.captainMultiplier = { multiplier: config.multipliers.captain, base: baseTotal };
  } else if (role === 'vice_captain') {
    total = Math.round(total * config.multipliers.viceCaptain);
    breakdown.vcMultiplier = { multiplier: config.multipliers.viceCaptain, base: baseTotal };
  }

  return { total, breakdown };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve strike rate points from tiered config.
 * Tiers must be ordered highest-first with non-overlapping ranges.
 * Upper bound is exclusive (SR of exactly 170 falls into the 150–170 tier).
 */
function getSrPoints(sr, tiers) {
  for (const tier of tiers) {
    if (sr >= tier.min && sr < tier.max) return tier.points;
  }
  return 0;
}

/**
 * Resolve economy rate points from tiered config.
 * Lower economy = better. Tiers ordered lowest-first.
 */
function getEconomyPoints(economy, tiers) {
  for (const tier of tiers) {
    if (economy >= tier.min && economy < tier.max) return tier.points;
  }
  return 0;
}

/**
 * Convert overs notation (e.g. 3.4) to total balls (e.g. 22).
 * The decimal part represents balls, not tenths of an over.
 */
function oversToTotalBalls(overs) {
  const completedOvers = Math.floor(overs);
  const balls = Math.round((overs - completedOvers) * 10);
  return completedOvers * 6 + balls;
}

module.exports = { calculateFantasyPoints, getSrPoints, getEconomyPoints, oversToTotalBalls };
