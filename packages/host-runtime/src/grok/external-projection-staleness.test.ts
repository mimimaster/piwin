import { describe, expect, it } from 'vitest';
import { externalProjectionNeedsReplay } from './external-projection-staleness.js';

describe('externalProjectionNeedsReplay', () => {
  it('has nothing to replay before the agent assigned a native session', () => {
    expect(externalProjectionNeedsReplay({ agentId: 'grok' }, 10)).toBe(false);
  });

  it('replays a catalog-imported session that was never projected', () => {
    expect(externalProjectionNeedsReplay({ agentId: 'grok', backendSessionId: 'native' }, undefined)).toBe(true);
  });

  it('replays only when the agent changed the session after the last sync', () => {
    const binding = { agentId: 'grok', backendSessionId: 'native', syncedChangeUnixMs: 100 };
    expect(externalProjectionNeedsReplay(binding, undefined)).toBe(false);
    expect(externalProjectionNeedsReplay(binding, 100)).toBe(false);
    expect(externalProjectionNeedsReplay(binding, 101)).toBe(true);
  });
});
