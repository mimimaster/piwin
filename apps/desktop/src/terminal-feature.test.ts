import { describe, expect, it } from 'vitest';
import { canOpenEmbeddedTui, isTerminalFeatureEnabled } from './terminal-feature';

describe('terminal rollout', () => {
  it('defaults off in production and on in development and test environments', () => {
    expect(isTerminalFeatureEnabled(undefined, { development: false, mode: 'production' })).toBe(false);
    expect(isTerminalFeatureEnabled(undefined, { development: true, mode: 'development' })).toBe(true);
    expect(isTerminalFeatureEnabled(undefined, { development: false, mode: 'test' })).toBe(true);
    expect(isTerminalFeatureEnabled(undefined, {
      development: false, mode: 'production', e2eFixtures: 'true',
    })).toBe(true);
  });

  it('honors explicit enable and disable preferences', () => {
    expect(isTerminalFeatureEnabled(true, { development: false, mode: 'production' })).toBe(true);
    expect(isTerminalFeatureEnabled(false, { development: true, mode: 'test' })).toBe(false);
  });

  it('offers the TUI on an enabled Desktop attached to its local or remote Host', () => {
    const local = { terminalEnabled: true, nativePtyAvailable: true, transport: 'live' } as const;
    expect(canOpenEmbeddedTui(local)).toBe(true);
    expect(canOpenEmbeddedTui({ ...local, terminalEnabled: false })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, nativePtyAvailable: false })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, transport: 'remote', remoteTargetAvailable: true })).toBe(true);
    expect(canOpenEmbeddedTui({ ...local, transport: 'remote' })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, transport: 'mock' })).toBe(false);
  });
});
