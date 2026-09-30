import { describe, expect, it } from 'vitest';
import type { SessionBackendCapabilities, SessionBackendOptions } from '@piwin/contracts';
import {
  backendCapabilitiesFor,
  backendOptionsFor,
  isAgentReady,
  mergeAgentStatus,
  setBackendCapabilities,
  setBackendOptions,
} from './agent-backend-state';
import { notInstalledAgent, readyAgent } from './agent-backend-state.fixtures';

describe('isAgentReady', () => {
  it('is true only for the ready state', () => {
    expect(isAgentReady(readyAgent())).toBe(true);
    expect(isAgentReady(notInstalledAgent())).toBe(false);
    expect(
      isAgentReady({
        agentId: 'grok',
        state: 'unauthenticated',
        binaryPath: '/usr/local/bin/grok',
        version: '1.0.44',
        supportStatus: 'verified',
        checkedAt: '2026-09-30T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(isAgentReady(undefined)).toBe(false);
  });
});

describe('mergeAgentStatus', () => {
  it('appends an unknown agent instead of dropping it', () => {
    const merged = mergeAgentStatus([notInstalledAgent('grok')], readyAgent('other'));
    expect(merged.map((agent) => agent.agentId)).toEqual(['grok', 'other']);
  });

  it('replaces the existing entry in place', () => {
    const merged = mergeAgentStatus([notInstalledAgent('grok')], readyAgent('grok'));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe('ready');
  });
});

const capabilities: SessionBackendCapabilities = {
  agentId: 'grok',
  operations: {} as SessionBackendCapabilities['operations'],
};

const options: SessionBackendOptions = {
  agentId: 'grok',
  models: [],
  modes: [],
  modeConfirmed: true,
  commands: [],
};

describe('session backend maps', () => {
  it('bind and read capabilities', () => {
    const empty: Record<string, SessionBackendCapabilities> = {};
    const bound = setBackendCapabilities(empty, 's-1', capabilities);
    expect(bound['s-1']).toBe(capabilities);
    expect(backendCapabilitiesFor(bound, 's-1')).toBe(capabilities);
    expect(backendCapabilitiesFor(bound, 'missing')).toBeUndefined();
    expect(backendCapabilitiesFor(bound, null)).toBeUndefined();
  });

  it('leave the map untouched when the value is undefined', () => {
    const empty: Record<string, SessionBackendCapabilities> = {};
    expect(setBackendCapabilities(empty, 's-1', undefined)).toBe(empty);
  });

  it('bind and read options', () => {
    const empty: Record<string, SessionBackendOptions> = {};
    const bound = setBackendOptions(empty, 's-1', options);
    expect(bound['s-1']).toBe(options);
    expect(backendOptionsFor(bound, 's-1')).toBe(options);
    expect(backendOptionsFor(bound, 'missing')).toBeUndefined();
    expect(backendOptionsFor(bound, undefined)).toBeUndefined();
  });
});
