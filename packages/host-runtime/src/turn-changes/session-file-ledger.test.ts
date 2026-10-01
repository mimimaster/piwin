import { describe, expect, it } from 'vitest';

import { createSessionFileLedger, judgeForeignFileChange } from './session-file-ledger.js';

const quiet = { complete: true, fileWrites: [], exclusiveCount: 0, shellCount: 0 };

describe('judgeForeignFileChange', () => {
  it('allows a first write and an unchanged file', () => {
    expect(judgeForeignFileChange({ entry: undefined, currentSha: 'x', others: quiet, ownShellCount: 0 })).toEqual({
      conflict: false,
    });
    expect(
      judgeForeignFileChange({
        entry: { sha: 'x', tick: 1 },
        currentSha: 'x',
        others: { ...quiet, shellCount: 3 },
        ownShellCount: 0,
      }),
    ).toEqual({ conflict: false });
  });

  it('allows drift nobody else could have caused (own formatter, external editor)', () => {
    expect(
      judgeForeignFileChange({ entry: { sha: 'x', tick: 1 }, currentSha: 'y', others: quiet, ownShellCount: 0 }),
    ).toEqual({ conflict: false });
  });

  it('refuses drift when another session wrote the file or ran commands meanwhile', () => {
    const entry = { sha: 'x', tick: 1 };
    expect(
      judgeForeignFileChange({
        entry,
        currentSha: 'y',
        others: { ...quiet, fileWrites: ['/r/a.ts'] },
        ownShellCount: 2,
      }),
    ).toEqual({ conflict: true, byHostWrite: true });
    expect(
      judgeForeignFileChange({ entry, currentSha: null, others: { ...quiet, shellCount: 1 }, ownShellCount: 0 }),
    ).toEqual({ conflict: true, byHostWrite: false });
  });

  it('gives an ambiguous shell overlap to this session (its own formatter while another searched)', () => {
    expect(
      judgeForeignFileChange({
        entry: { sha: 'x', tick: 1 },
        currentSha: 'y',
        others: { ...quiet, shellCount: 1 },
        ownShellCount: 1,
      }),
    ).toEqual({ conflict: false });
  });

  it('stays optimistic when the history no longer covers the window', () => {
    expect(
      judgeForeignFileChange({
        entry: { sha: 'x', tick: 1 },
        currentSha: 'y',
        others: { ...quiet, complete: false, shellCount: 4 },
        ownShellCount: 0,
      }),
    ).toEqual({ conflict: false });
  });
});

describe('createSessionFileLedger', () => {
  it('keys by owner and file and evicts the least recently written', () => {
    const ledger = createSessionFileLedger({ capacity: 2 });
    ledger.record('a', '/r/x', { sha: '1', tick: 1 });
    ledger.record('b', '/r/x', { sha: '2', tick: 2 });
    ledger.record('a', '/r/x', { sha: '3', tick: 3 });
    ledger.record('a', '/r/y', { sha: '4', tick: 4 });
    expect(ledger.lookup('b', '/r/x')).toBeUndefined();
    expect(ledger.lookup('a', '/r/x')).toEqual({ sha: '3', tick: 3 });
    expect(ledger.lookup('a', '/r/y')).toEqual({ sha: '4', tick: 4 });
  });
});
