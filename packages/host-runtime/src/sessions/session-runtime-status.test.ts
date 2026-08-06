import { describe, expect, it } from 'vitest';
import {
  IMMEDIATE_TIGHTENING_DOMAINS,
  RUNTIME_STALE_DOMAINS,
  isImmediateTighteningDomain,
  isRuntimeStaleDomain,
} from '@piwin/contracts';
import { computeRuntimeStatus, type ComputeRuntimeStatusInput } from './session-runtime-status.js';

function input(overrides: Partial<ComputeRuntimeStatusInput> = {}): ComputeRuntimeStatusInput {
  return {
    sessionId: 's1',
    activeGeneration: true,
    currentSettingsRevision: 'rev-2',
    changedDomains: [],
    ...overrides,
  };
}

describe('runtime stale domain classification (contracts)', () => {
  it('resource/tool/provider domains are runtime-stale', () => {
    for (const domain of [
      'providers',
      'web',
      'skills',
      'extensions',
      'prompts',
      'permissions',
      'subagents',
    ]) {
      expect(isRuntimeStaleDomain(domain as never)).toBe(true);
    }
  });

  it('appearance/artifact/media domains are not runtime-stale', () => {
    for (const domain of [
      'desktop',
      'artifact',
      'media',
      'visionDelegation',
      'automation',
      'mcp',
    ]) {
      expect(isRuntimeStaleDomain(domain as never)).toBe(false);
    }
  });

  it('safety domains tighten immediately', () => {
    for (const domain of [
      'permissions',
      'web',
      'process',
      'notes',
      'flashcards',
      'subagents',
    ]) {
      expect(isImmediateTighteningDomain(domain as never)).toBe(true);
    }
    expect(isImmediateTighteningDomain('mcp' as never)).toBe(false);
  });
});

describe('computeRuntimeStatus', () => {
  it('live runtime with no changed domains stays live', () => {
    const result = computeRuntimeStatus(input());
    expect(result.stale).toBe(false);
    expect(result.immediateTightening).toBe(false);
    expect(result.status.state).toBe('live');
    expect(result.status.staleDomains).toEqual([]);
  });

  it('Settings mutation marks only affected sessions/domains stale', () => {
    const result = computeRuntimeStatus(input({ changedDomains: ['skills', 'desktop'] }));
    expect(result.stale).toBe(true);
    expect(result.status.state).toBe('stale');
    expect(result.status.staleDomains).toEqual(['skills']);
    // desktop is not a runtime-stale domain; it must not mark the runtime stale.
    expect(result.status.staleDomains).not.toContain('desktop');
  });

  it('active run is not silently aborted; tightening flag set instead', () => {
    const result = computeRuntimeStatus(input({ changedDomains: ['permissions'] }));
    expect(result.stale).toBe(true);
    expect(result.immediateTightening).toBe(true);
    expect(result.status.state).toBe('stale');
  });

  it('lazy-shell (no active generation) is reported without a live claim', () => {
    const result = computeRuntimeStatus(
      input({ activeGeneration: false, changedDomains: ['web'] }),
    );
    expect(result.status.state).toBe('lazy-shell');
    expect(result.status.generationId).toBeUndefined();
    expect(result.stale).toBe(true);
  });

  it('new session uses latest snapshot (no stale domains, live)', () => {
    const result = computeRuntimeStatus(input({ activeGeneration: true, changedDomains: [] }));
    expect(result.status.state).toBe('live');
    expect(result.status.staleDomains).toEqual([]);
  });
});
