'use strict';

/**
 * Calculate prize distribution for a match.
 *
 * Rules:
 *  - Entry: entryUnits per participant (default 300)
 *  - Total pool = participants * entryUnits
 *  - 0–1 participants  → no prizes, pool carries over (returned as carryOver)
 *  - 2–4 participants  → 2 winners: 60% / 40%
 *  - 5+ participants   → 3 winners: 50% / 30% / 20%
 *  - Ties: merge tied positions' prize money and split equally
 *  - Net units = prize won - entryUnits
 *
 * @param {Array}  rankedEntries   - Array of { userId, fantasyPoints } sorted desc by fantasyPoints
 * @param {number} entryUnits      - Units paid per participant (default 300)
 *
 * @returns {object} {
 *   totalPool,
 *   distributionRule,   // '2-winner' | '3-winner' | 'no-prize'
 *   prizes,             // Array of { userId, rank, grossUnits, netUnits, fantasyPoints }
 *   carryOver,          // units carried over if no-prize scenario
 *   participantCount,
 * }
 */
function distributePrizes(rankedEntries, entryUnits = 300) {
  const participantCount = rankedEntries.length;
  const totalPool = participantCount * entryUnits;

  // Not enough participants
  if (participantCount < 2) {
    return {
      totalPool,
      distributionRule: 'no-prize',
      prizes: rankedEntries.map(e => ({
        userId: e.userId,
        rank: 1,
        grossUnits: 0,
        netUnits: -entryUnits,
        fantasyPoints: e.fantasyPoints,
      })),
      carryOver: totalPool,
      participantCount,
    };
  }

  // Determine split percentages
  const percentages = participantCount >= 5
    ? [0.50, 0.30, 0.20]
    : [0.60, 0.40];

  const distributionRule = participantCount >= 5 ? '3-winner' : '2-winner';

  // Assign raw ranks (ties get the same rank)
  const ranked = assignRanks(rankedEntries);

  // Build prize pool per rank position (before tie-splitting)
  const grossByPosition = percentages.map(pct => Math.floor(totalPool * pct));

  // Fix any rounding — add remainder to first place
  const distributed = grossByPosition.reduce((a, b) => a + b, 0);
  grossByPosition[0] += totalPool - distributed;

  // Resolve ties — merge and split prizes for tied ranks
  const prizes = resolveTies(ranked, grossByPosition, entryUnits);

  return {
    totalPool,
    distributionRule,
    prizes,
    carryOver: 0,
    participantCount,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Assign rank numbers to entries.
 * Tied scores share the same rank.
 * e.g. scores [100, 100, 80, 60] → ranks [1, 1, 3, 4]
 */
function assignRanks(entries) {
  const result = [];
  let rank = 1;

  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].fantasyPoints < entries[i - 1].fantasyPoints) {
      rank = i + 1;
    }
    result.push({ ...entries[i], rank });
  }

  return result;
}

/**
 * Resolve prize distribution accounting for ties.
 * When multiple players share a rank that has prize money,
 * the combined prize for those positions is split equally.
 */
function resolveTies(ranked, grossByPosition, entryUnits) {
  const prizes = [];
  const numPrizePositions = grossByPosition.length;

  // Group players by rank
  const rankGroups = {};
  for (const entry of ranked) {
    if (!rankGroups[entry.rank]) rankGroups[entry.rank] = [];
    rankGroups[entry.rank].push(entry);
  }

  for (const [rankStr, group] of Object.entries(rankGroups)) {
    const rank = parseInt(rankStr, 10);

    // Collect all prize positions this group occupies
    // e.g. 2 players tied at rank 1 occupy positions 1 and 2
    const positions = [];
    for (let pos = rank; pos < rank + group.length; pos++) {
      if (pos <= numPrizePositions) {
        positions.push(pos);
      }
    }

    // Sum the gross prize for those positions
    const combinedGross = positions.reduce(
      (sum, pos) => sum + (grossByPosition[pos - 1] ?? 0),
      0
    );

    // Split equally among tied players (floor, give remainder to first)
    const splitBase  = Math.floor(combinedGross / group.length);
    const remainder  = combinedGross - splitBase * group.length;

    group.forEach((entry, idx) => {
      const gross = splitBase + (idx === 0 ? remainder : 0);
      prizes.push({
        userId:        entry.userId,
        rank,
        grossUnits:    gross,
        netUnits:      gross - entryUnits,
        fantasyPoints: entry.fantasyPoints,
      });
    });
  }

  // Sort by rank for readability
  prizes.sort((a, b) => a.rank - b.rank || b.fantasyPoints - a.fantasyPoints);

  return prizes;
}

module.exports = { distributePrizes, assignRanks, resolveTies };
