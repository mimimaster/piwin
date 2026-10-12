import { describe, expect, it } from 'vitest';
import { canOpenEmbeddedTui } from './terminal-feature';

describe('embedded TUI availability', () => {
  it('offers the TUI on Desktop attached to its local or remote Host', () => {
    const local = { nativePtyAvailable: true, transport: 'live' } as const;
    expect(canOpenEmbeddedTui(local)).toBe(true);
    expect(canOpenEmbeddedTui({ ...local, nativePtyAvailable: false })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, transport: 'remote', remoteTargetAvailable: true })).toBe(true);
    expect(canOpenEmbeddedTui({ ...local, transport: 'remote' })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, transport: 'mock' })).toBe(false);
  });
});
