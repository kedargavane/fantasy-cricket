'use strict';

const { calculateFantasyPoints, getSrPoints, getEconomyPoints, oversToTotalBalls } = require('../../src/engines/scoringEngine');

// ── Helper ────────────────────────────────────────────────────────────────────
const base = {
  isPlayingXi: true,
  runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissalType: 'notout',
  oversBowled: 0, wickets: 0, runsConceded: 0, maidens: 0,
  catches: 0, stumpings: 0, runOuts: 0,
};

function player(overrides) {
  return { ...base, ...overrides };
}

// ── Playing XI bonus ──────────────────────────────────────────────────────────
describe('Playing XI bonus', () => {
  test('player in XI gets +4', () => {
    const { total } = calculateFantasyPoints(player({}));
    expect(total).toBe(4);
  });

  test('player NOT in XI gets 0 total', () => {
    const { total, breakdown } = calculateFantasyPoints(player({ isPlayingXi: false }));
    expect(total).toBe(0);
    expect(breakdown.notPlaying).toBe(true);
  });
});

// ── Batting: runs ─────────────────────────────────────────────────────────────
describe('Batting: runs', () => {
  test('30 runs = 30 points', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 30, ballsFaced: 25 }));
    expect(breakdown.runs).toBe(30);
  });

  test('0 runs not dismissed = no run points, no duck', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 0, ballsFaced: 5, dismissalType: 'notout' }));
    expect(breakdown.runs).toBeUndefined();
    expect(breakdown.duckPenalty).toBeUndefined();
  });
});

// ── Batting: boundaries ───────────────────────────────────────────────────────
describe('Batting: boundaries', () => {
  test('3 fours = +3 boundary bonus', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 12, ballsFaced: 12, fours: 3 }));
    expect(breakdown.boundaryBonus).toBe(3);
  });

  test('2 sixes = +4 six bonus', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 12, ballsFaced: 6, sixes: 2 }));
    expect(breakdown.sixBonus).toBe(4);
  });
});

// ── Batting: milestones ───────────────────────────────────────────────────────
describe('Batting: milestones', () => {
  test('50 runs = +8 half century', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 50, ballsFaced: 40 }));
    expect(breakdown.halfCenturyBonus).toBe(8);
    expect(breakdown.centuryBonus).toBeUndefined();
  });

  test('99 runs = +8 half century (not century)', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 99, ballsFaced: 70 }));
    expect(breakdown.halfCenturyBonus).toBe(8);
    expect(breakdown.centuryBonus).toBeUndefined();
  });

  test('100 runs = +16 century (not both)', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 100, ballsFaced: 75 }));
    expect(breakdown.centuryBonus).toBe(16);
    expect(breakdown.halfCenturyBonus).toBeUndefined();
  });

  test('150 runs = +16 century only', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 150, ballsFaced: 90 }));
    expect(breakdown.centuryBonus).toBe(16);
    expect(breakdown.halfCenturyBonus).toBeUndefined();
  });
});

// ── Batting: duck ─────────────────────────────────────────────────────────────
describe('Batting: duck', () => {
  test('dismissed for 0 = -2 duck penalty', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 0, ballsFaced: 3, dismissalType: 'bowled' }));
    expect(breakdown.duckPenalty).toBe(-2);
  });

  test('not dismissed, 0 runs = no duck penalty', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 0, ballsFaced: 0, dismissalType: 'notout' }));
    expect(breakdown.duckPenalty).toBeUndefined();
  });

  test('scored 1, then dismissed = no duck', () => {
    const { breakdown } = calculateFantasyPoints(player({ runs: 1, ballsFaced: 4, dismissalType: 'caught' }));
    expect(breakdown.duckPenalty).toBeUndefined();
  });
});

// ── Batting: strike rate ──────────────────────────────────────────────────────
describe('Batting: strike rate', () => {
  test('SR > 170 with 10+ balls = +6', () => {
    // 18 runs off 10 balls = SR 180
    const { breakdown } = calculateFantasyPoints(player({ runs: 18, ballsFaced: 10 }));
    expect(breakdown.strikeRatePoints).toBe(6);
  });

  test('SR 150–170 = +4', () => {
    // 16 runs off 10 balls = SR 160
    const { breakdown } = calculateFantasyPoints(player({ runs: 16, ballsFaced: 10 }));
    expect(breakdown.strikeRatePoints).toBe(4);
  });

  test('SR 130–150 = +2', () => {
    // 14 runs off 10 balls = SR 140
    const { breakdown } = calculateFantasyPoints(player({ runs: 14, ballsFaced: 10 }));
    expect(breakdown.strikeRatePoints).toBe(2);
  });

  test('SR 70–130 = 0 (neutral)', () => {
    // 10 runs off 10 balls = SR 100
    const { breakdown } = calculateFantasyPoints(player({ runs: 10, ballsFaced: 10 }));
    expect(breakdown.strikeRatePoints).toBeUndefined();
  });

  test('SR 60–70 = -2', () => {
    // 6.5 runs off 10 balls → use 6 runs off 9 balls = SR ~66.7
    const { breakdown } = calculateFantasyPoints(player({ runs: 6, ballsFaced: 9 }));
    expect(breakdown.strikeRatePoints).toBe(-2);
  });

  test('SR < 60 = -4', () => {
    // 5 runs off 10 balls = SR 50
    const { breakdown } = calculateFantasyPoints(player({ runs: 5, ballsFaced: 10 }));
    expect(breakdown.strikeRatePoints).toBe(-4);
  });

  test('fewer than 10 balls = no SR bonus/penalty', () => {
    // 20 runs off 9 balls = SR 222, but < minBalls
    const { breakdown } = calculateFantasyPoints(player({ runs: 20, ballsFaced: 9 }));
    expect(breakdown.strikeRatePoints).toBeUndefined();
  });
});

// ── Bowling: wickets ──────────────────────────────────────────────────────────
describe('Bowling: wickets', () => {
  test('1 wicket = 25 points', () => {
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 4, wickets: 1, runsConceded: 28 }));
    expect(breakdown.wicketPoints).toBe(25);
    expect(breakdown.wicketHaulBonus).toBeUndefined();
  });

  test('3 wickets = 75 + 4 haul bonus', () => {
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 4, wickets: 3, runsConceded: 24 }));
    expect(breakdown.wicketPoints).toBe(75);
    expect(breakdown.wicketHaulBonus).toBe(4);
  });

  test('4 wickets = 100 + 4 + 8 haul bonus = 12', () => {
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 4, wickets: 4, runsConceded: 20 }));
    expect(breakdown.wicketPoints).toBe(100);
    expect(breakdown.wicketHaulBonus).toBe(12);
  });

  test('5 wickets = 125 + 4 + 8 + 16 haul bonus = 28', () => {
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 4, wickets: 5, runsConceded: 18 }));
    expect(breakdown.wicketPoints).toBe(125);
    expect(breakdown.wicketHaulBonus).toBe(28);
  });
});

// ── Bowling: maidens ──────────────────────────────────────────────────────────
describe('Bowling: maidens', () => {
  test('2 maidens = 16 points', () => {
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 4, wickets: 0, runsConceded: 0, maidens: 2 }));
    expect(breakdown.maidenPoints).toBe(16);
  });
});

// ── Bowling: economy ──────────────────────────────────────────────────────────
describe('Bowling: economy rate', () => {
  test('ER < 6 with 2+ overs = +6', () => {
    // 10 runs off 2 overs = ER 5.0
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 2, wickets: 0, runsConceded: 10 }));
    expect(breakdown.economyPoints).toBe(6);
  });

  test('ER 6–7 = +4', () => {
    // 13 runs off 2 overs = ER 6.5
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 2, wickets: 0, runsConceded: 13 }));
    expect(breakdown.economyPoints).toBe(4);
  });

  test('ER 7–8 = +2', () => {
    // 15 runs off 2 overs = ER 7.5
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 2, wickets: 0, runsConceded: 15 }));
    expect(breakdown.economyPoints).toBe(2);
  });

  test('ER 8–10 = 0 (neutral)', () => {
    // 18 runs off 2 overs = ER 9.0
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 2, wickets: 0, runsConceded: 18 }));
    expect(breakdown.economyPoints).toBeUndefined();
  });

  test('ER 10–11 = -2', () => {
    // 21 runs off 2 overs = ER 10.5
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 2, wickets: 0, runsConceded: 21 }));
    expect(breakdown.economyPoints).toBe(-2);
  });

  test('ER > 11 = -4', () => {
    // 24 runs off 2 overs = ER 12.0
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 2, wickets: 0, runsConceded: 24 }));
    expect(breakdown.economyPoints).toBe(-4);
  });

  test('less than 2 overs = no economy bonus', () => {
    // 1 over only
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 1, wickets: 1, runsConceded: 4 }));
    expect(breakdown.economyPoints).toBeUndefined();
  });

  test('fractional overs counted correctly (3.4 = 3 overs 4 balls)', () => {
    // 3.4 overs = 22 balls = 3.667 overs for economy
    // 18 runs / 3.667 = ER ~4.9 → +6
    const { breakdown } = calculateFantasyPoints(player({ oversBowled: 3.4, wickets: 1, runsConceded: 18 }));
    expect(breakdown.economyPoints).toBe(6);
  });
});

// ── Dismissal: LBW / Bowled bonus ────────────────────────────────────────────
describe('Dismissal: LBW/Bowled bonus', () => {
  test('bowled dismissal = +8 to bowler', () => {
    const { breakdown } = calculateFantasyPoints(player({
      oversBowled: 4, wickets: 1, runsConceded: 20,
      bowlerDismissalType: 'bowled'
    }));
    expect(breakdown.lbwBowledBonus).toBe(8);
  });

  test('lbw dismissal = +8 to bowler', () => {
    const { breakdown } = calculateFantasyPoints(player({
      oversBowled: 4, wickets: 1, runsConceded: 20,
      bowlerDismissalType: 'lbw'
    }));
    expect(breakdown.lbwBowledBonus).toBe(8);
  });

  test('caught dismissal = no lbw/bowled bonus', () => {
    const { breakdown } = calculateFantasyPoints(player({
      oversBowled: 4, wickets: 1, runsConceded: 20,
      bowlerDismissalType: 'caught'
    }));
    expect(breakdown.lbwBowledBonus).toBeUndefined();
  });
});

// ── Fielding ──────────────────────────────────────────────────────────────────
describe('Fielding', () => {
  test('2 catches = 16 points', () => {
    const { breakdown } = calculateFantasyPoints(player({ catches: 2 }));
    expect(breakdown.catchPoints).toBe(16);
  });

  test('1 stumping = 12 points', () => {
    const { breakdown } = calculateFantasyPoints(player({ stumpings: 1 }));
    expect(breakdown.stumpingPoints).toBe(12);
  });

  test('1 run out = 10 points', () => {
    const { breakdown } = calculateFantasyPoints(player({ runOuts: 1 }));
    expect(breakdown.runOutPoints).toBe(10);
  });
});

// ── Captain / VC multipliers ──────────────────────────────────────────────────
describe('Multipliers', () => {
  test('captain (2x) doubles total', () => {
    // 4 (XI) + 30 runs = 34 base → 68 as captain
    const { total } = calculateFantasyPoints(player({ runs: 30, ballsFaced: 20 }), 'captain');
    expect(total).toBe(68);
  });

  test('vice captain (1.5x) multiplies total', () => {
    // 4 (XI) + 30 runs = 34 base → 51 as VC
    const { total } = calculateFantasyPoints(player({ runs: 30, ballsFaced: 20 }), 'vice_captain');
    expect(total).toBe(51);
  });

  test('normal player gets no multiplier', () => {
    const { total } = calculateFantasyPoints(player({ runs: 30, ballsFaced: 20 }), 'normal');
    expect(total).toBe(34);
  });
});

// ── Full player scenario ──────────────────────────────────────────────────────
describe('Full player scenario', () => {
  test('all-round performance', () => {
    // Virat-like: 75 runs, 50 balls (SR 150 = +4), 3 fours, 2 sixes
    // Also: 2 overs, 1 wicket, 10 runs (ER 5 = +6), 1 catch
    const stats = player({
      runs: 75, ballsFaced: 50, fours: 3, sixes: 2,
      oversBowled: 2, wickets: 1, runsConceded: 10,
      catches: 1,
    });
    const { total, breakdown } = calculateFantasyPoints(stats, 'normal');
    expect(breakdown.playingXiBonus).toBe(4);
    expect(breakdown.runs).toBe(75);
    expect(breakdown.boundaryBonus).toBe(3);
    expect(breakdown.sixBonus).toBe(4);
    expect(breakdown.halfCenturyBonus).toBe(8);
    expect(breakdown.strikeRatePoints).toBe(4);   // SR exactly 150 → falls in 130–150 tier
    expect(breakdown.wicketPoints).toBe(25);
    expect(breakdown.economyPoints).toBe(6);
    expect(breakdown.catchPoints).toBe(8);
    // 4+75+3+4+8+4+25+6+8 = 137
    expect(total).toBe(137);
  });

  test('captain all-round performance doubles total', () => {
    const stats = player({
      runs: 75, ballsFaced: 50, fours: 3, sixes: 2,
      oversBowled: 2, wickets: 1, runsConceded: 10,
      catches: 1,
    });
    const { total } = calculateFantasyPoints(stats, 'captain');
    expect(total).toBe(274); // 137 * 2
  });
});

// ── Utility functions ─────────────────────────────────────────────────────────
describe('oversToTotalBalls', () => {
  test('4.0 overs = 24 balls', () => expect(oversToTotalBalls(4.0)).toBe(24));
  test('3.4 overs = 22 balls', () => expect(oversToTotalBalls(3.4)).toBe(22));
  test('0.3 overs = 3 balls',  () => expect(oversToTotalBalls(0.3)).toBe(3));
  test('1.0 overs = 6 balls',  () => expect(oversToTotalBalls(1.0)).toBe(6));
});
