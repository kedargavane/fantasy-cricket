'use strict';

const { distributePrizes, assignRanks } = require('../../src/engines/prizeEngine');

// ── Helpers ───────────────────────────────────────────────────────────────────
function entries(...points) {
  return points.map((fp, i) => ({ userId: `user${i + 1}`, fantasyPoints: fp }));
}

// ── No prize scenarios ────────────────────────────────────────────────────────
describe('distributePrizes: no prize scenarios', () => {
  test('0 participants → no prizes, carryOver = 0', () => {
    const result = distributePrizes([]);
    expect(result.distributionRule).toBe('no-prize');
    expect(result.carryOver).toBe(0);
    expect(result.totalPool).toBe(0);
  });

  test('1 participant → no prize, carryOver = 300', () => {
    const result = distributePrizes(entries(100));
    expect(result.distributionRule).toBe('no-prize');
    expect(result.carryOver).toBe(300);
    expect(result.prizes[0].netUnits).toBe(-300);
  });
});

// ── 2-winner scenarios (2–4 participants) ─────────────────────────────────────
describe('distributePrizes: 2-winner (2–4 participants)', () => {
  test('2 participants → pool 600, 1st gets 360, 2nd gets 240', () => {
    const result = distributePrizes(entries(100, 80));
    expect(result.distributionRule).toBe('2-winner');
    expect(result.totalPool).toBe(600);
    expect(result.prizes[0].grossUnits).toBe(360); // 60%
    expect(result.prizes[1].grossUnits).toBe(240); // 40%
  });

  test('2 participants → net units correct (gross - 300)', () => {
    const result = distributePrizes(entries(100, 80));
    expect(result.prizes[0].netUnits).toBe(60);   // 360 - 300
    expect(result.prizes[1].netUnits).toBe(-60);  // 240 - 300
  });

  test('4 participants → 2-winner rule still applies', () => {
    const result = distributePrizes(entries(100, 90, 80, 70));
    expect(result.distributionRule).toBe('2-winner');
    expect(result.totalPool).toBe(1200);
    expect(result.prizes[0].grossUnits).toBe(720); // 60% of 1200
    expect(result.prizes[1].grossUnits).toBe(480); // 40% of 1200
  });
});

// ── 3-winner scenarios (5+ participants) ──────────────────────────────────────
describe('distributePrizes: 3-winner (5+ participants)', () => {
  test('5 participants → pool 1500, 50/30/20 split', () => {
    const result = distributePrizes(entries(100, 90, 80, 70, 60));
    expect(result.distributionRule).toBe('3-winner');
    expect(result.totalPool).toBe(1500);
    expect(result.prizes[0].grossUnits).toBe(750); // 50%
    expect(result.prizes[1].grossUnits).toBe(450); // 30%
    expect(result.prizes[2].grossUnits).toBe(300); // 20%
  });

  test('5 participants → net units correct', () => {
    const result = distributePrizes(entries(100, 90, 80, 70, 60));
    expect(result.prizes[0].netUnits).toBe(450);   // 750 - 300
    expect(result.prizes[1].netUnits).toBe(150);   // 450 - 300
    expect(result.prizes[2].netUnits).toBe(0);     // 300 - 300
    expect(result.prizes[3].netUnits).toBe(-300);  // 0 - 300
    expect(result.prizes[4].netUnits).toBe(-300);  // 0 - 300
  });

  test('20 participants → 3-winner rule', () => {
    const pts = Array.from({ length: 20 }, (_, i) => 200 - i * 5);
    const result = distributePrizes(entries(...pts));
    expect(result.distributionRule).toBe('3-winner');
    expect(result.totalPool).toBe(6000);
    expect(result.prizes[0].grossUnits).toBe(3000);
    expect(result.prizes[1].grossUnits).toBe(1800);
    expect(result.prizes[2].grossUnits).toBe(1200);
  });
});

// ── Tie handling ──────────────────────────────────────────────────────────────
describe('distributePrizes: tie handling', () => {
  test('2-way tie for 1st: both share 1st+2nd prize (2-winner)', () => {
    // pool=600, 60%=360, 40%=240, combined=600, each gets 300
    const result = distributePrizes(entries(100, 100));
    expect(result.prizes[0].grossUnits).toBe(300);
    expect(result.prizes[1].grossUnits).toBe(300);
    expect(result.prizes[0].rank).toBe(1);
    expect(result.prizes[1].rank).toBe(1);
    expect(result.prizes[0].netUnits).toBe(0);
    expect(result.prizes[1].netUnits).toBe(0);
  });

  test('2-way tie for 1st in 3-winner: share 1st+2nd prize (50%+30%=80%)', () => {
    // pool=1500, 50%=750, 30%=450, combined=1200, each gets 600
    const result = distributePrizes(entries(100, 100, 80, 70, 60));
    const tied = result.prizes.filter(p => p.rank === 1);
    expect(tied).toHaveLength(2);
    expect(tied[0].grossUnits).toBe(600);
    expect(tied[1].grossUnits).toBe(600);
    // 3rd place still gets 20% = 300
    const third = result.prizes.find(p => p.rank === 3);
    expect(third.grossUnits).toBe(300);
  });

  test('3-way tie for 1st in 3-winner: share all 3 prizes equally', () => {
    // pool=1500, all 3 share (750+450+300)=1500, each gets 500
    const result = distributePrizes(entries(100, 100, 100, 70, 60));
    const tied = result.prizes.filter(p => p.rank === 1);
    expect(tied).toHaveLength(3);
    tied.forEach(p => expect(p.grossUnits).toBe(500));
  });

  test('tie for 2nd place only', () => {
    // pool=1500, 1st=750, 2nd+3rd tied: share (450+300)=750, each gets 375
    const result = distributePrizes(entries(100, 80, 80, 70, 60));
    const first = result.prizes.find(p => p.rank === 1);
    const tied2nd = result.prizes.filter(p => p.rank === 2);
    expect(first.grossUnits).toBe(750);
    expect(tied2nd).toHaveLength(2);
    expect(tied2nd[0].grossUnits).toBe(375);
    expect(tied2nd[1].grossUnits).toBe(375);
  });
});

// ── Custom entry units ────────────────────────────────────────────────────────
describe('distributePrizes: custom entry units', () => {
  test('500 unit entry, 5 participants', () => {
    const result = distributePrizes(entries(100, 90, 80, 70, 60), 500);
    expect(result.totalPool).toBe(2500);
    expect(result.prizes[0].grossUnits).toBe(1250); // 50%
    expect(result.prizes[0].netUnits).toBe(750);    // 1250 - 500
  });
});

// ── assignRanks ───────────────────────────────────────────────────────────────
describe('assignRanks', () => {
  test('unique scores get sequential ranks', () => {
    const result = assignRanks(entries(100, 90, 80));
    expect(result.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  test('tied scores share rank, next rank skips', () => {
    const result = assignRanks(entries(100, 100, 80));
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
    expect(result[2].rank).toBe(3);
  });
});

// ── Pool integrity ────────────────────────────────────────────────────────────
describe('distributePrizes: pool integrity', () => {
  test('total prizes always equal total pool (no-prize scenario)', () => {
    const result = distributePrizes(entries(100));
    expect(result.carryOver).toBe(result.totalPool);
  });

  test('total gross prizes = total pool for 5 participants', () => {
    const result = distributePrizes(entries(100, 90, 80, 70, 60));
    const totalAwarded = result.prizes.reduce((s, p) => s + p.grossUnits, 0);
    expect(totalAwarded).toBe(result.totalPool);
  });

  test('total gross prizes = total pool for 2 participants with tie', () => {
    const result = distributePrizes(entries(100, 100));
    const totalAwarded = result.prizes.reduce((s, p) => s + p.grossUnits, 0);
    expect(totalAwarded).toBe(result.totalPool);
  });
});
