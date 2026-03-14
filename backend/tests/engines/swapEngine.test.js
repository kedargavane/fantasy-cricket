'use strict';

const { resolveTeam } = require('../../src/engines/swapEngine');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makePlayer(id, name) {
  return { id, name };
}

function makeTeam(overrides = {}) {
  const mainPlayers = Array.from({ length: 11 }, (_, i) =>
    makePlayer(`p${i + 1}`, `Player ${i + 1}`)
  );
  return {
    mainPlayers,
    backups: [makePlayer('b1', 'Backup 1'), makePlayer('b2', 'Backup 2')],
    captainId: 'p1',
    viceCaptainId: 'p2',
    ...overrides,
  };
}

// All 11 main + both backups are in XI
function allPlayingXi(team) {
  return new Set([
    ...team.mainPlayers.map(p => p.id),
    ...team.backups.map(p => p.id),
  ]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('resolveTeam: no swaps needed', () => {
  test('all 11 in XI — team unchanged, no swaps logged', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    const { finalTeam, captainId, viceCaptainId, swapLog } = resolveTeam(team, xi);

    expect(finalTeam.map(p => p.id)).toEqual(team.mainPlayers.map(p => p.id));
    expect(captainId).toBe('p1');
    expect(viceCaptainId).toBe('p2');
    expect(swapLog).toHaveLength(0);
  });
});

describe('resolveTeam: single swap', () => {
  test('p3 not in XI → replaced by B1', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p3');

    const { finalTeam, swapLog } = resolveTeam(team, xi);

    expect(finalTeam[2].id).toBe('b1');
    expect(swapLog).toHaveLength(1);
    expect(swapLog[0].type).toBe('swapped');
    expect(swapLog[0].swappedOut.id).toBe('p3');
    expect(swapLog[0].swappedIn.id).toBe('b1');
    expect(swapLog[0].inheritedRole).toBeNull();
  });

  test('captain (p1) not in XI → B1 becomes new captain', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p1');

    const { finalTeam, captainId, swapLog } = resolveTeam(team, xi);

    expect(finalTeam[0].id).toBe('b1');
    expect(captainId).toBe('b1');
    expect(swapLog[0].inheritedRole).toBe('captain');
  });

  test('vice-captain (p2) not in XI → B1 becomes new VC', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p2');

    const { finalTeam, viceCaptainId, swapLog } = resolveTeam(team, xi);

    expect(finalTeam[1].id).toBe('b1');
    expect(viceCaptainId).toBe('b1');
    expect(swapLog[0].inheritedRole).toBe('vice_captain');
  });
});

describe('resolveTeam: two swaps', () => {
  test('p3 and p5 not in XI → p3→B1, p5→B2', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p3');
    xi.delete('p5');

    const { finalTeam, swapLog } = resolveTeam(team, xi);

    expect(finalTeam[2].id).toBe('b1');
    expect(finalTeam[4].id).toBe('b2');
    expect(swapLog.filter(s => s.type === 'swapped')).toHaveLength(2);
  });

  test('both captain and VC not in XI → roles transfer to B1 and B2', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p1'); // captain
    xi.delete('p2'); // VC

    const { captainId, viceCaptainId } = resolveTeam(team, xi);

    expect(captainId).toBe('b1');
    expect(viceCaptainId).toBe('b2');
  });
});

describe('resolveTeam: backup not in XI', () => {
  test('p3 not in XI, B1 also not in XI → slot scores 0, B2 still available', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p3');
    xi.delete('b1'); // B1 not playing

    const { finalTeam, swapLog } = resolveTeam(team, xi);

    // p3 slot stays as p3 (not swapped) because B1 wasn't in XI
    expect(finalTeam[2].id).toBe('p3');
    const failedSwap = swapLog.find(s => s.type === 'backup_not_in_xi');
    expect(failedSwap).toBeDefined();
    expect(failedSwap.backup.id).toBe('b1');
  });

  test('p3 not in XI (B1 not in XI), p5 not in XI → p5 gets B2', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p3');
    xi.delete('p5');
    xi.delete('b1'); // B1 not playing

    const { finalTeam, swapLog } = resolveTeam(team, xi);

    expect(finalTeam[2].id).toBe('p3'); // stayed, B1 wasn't in XI
    expect(finalTeam[4].id).toBe('b2'); // B2 swapped in for p5
    expect(swapLog.find(s => s.type === 'swapped').swappedIn.id).toBe('b2');
  });

  test('more than 2 non-XI players → 3rd slot gets no_backup_available', () => {
    const team = makeTeam();
    const xi   = allPlayingXi(team);
    xi.delete('p3');
    xi.delete('p5');
    xi.delete('p7');

    const { swapLog } = resolveTeam(team, xi);

    const noBackup = swapLog.find(s => s.type === 'no_backup_available');
    expect(noBackup).toBeDefined();
    expect(noBackup.player.id).toBe('p7');
  });
});

describe('resolveTeam: validation', () => {
  test('throws if mainPlayers.length !== 11', () => {
    const team = makeTeam({ mainPlayers: [makePlayer('p1', 'P1')] });
    expect(() => resolveTeam(team, new Set(['p1']))).toThrow('expected 11 main players');
  });

  test('throws if backups.length !== 2', () => {
    const team = makeTeam({ backups: [makePlayer('b1', 'B1')] });
    expect(() => resolveTeam(team, new Set())).toThrow('expected 2 backups');
  });
});
