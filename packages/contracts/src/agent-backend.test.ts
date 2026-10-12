import { describe, expect, it } from 'vitest';
import {
  createPiSessionCapabilities,
  isAgentBackendId,
  isAllowPermissionOptionKind,
  isBackendPermissionOptionKind,
  isExternalAgentNativeCliReady,
  isExternalBackendBinding,
  isNativeCliSupported,
  isSessionOperationSupported,
  nativeCliUnsupportedReason,
  parseSessionBackendBinding,
  resolveSessionAgentId,
  SESSION_BACKEND_OPERATIONS,
  sessionOperationUnsupportedReason,
  type ExternalAgentStatus,
  type SessionBackendCapabilities,
} from './index.js';

describe('session backend binding', () => {
  it('treats an absent binding as Pi', () => {
    expect(resolveSessionAgentId(undefined)).toBe('pi');
    expect(isExternalBackendBinding(undefined)).toBe(false);
  });

  it('preserves an unknown agent id instead of coercing it to Pi', () => {
    const binding = parseSessionBackendBinding({ agentId: 'future-agent' });
    expect(binding).toEqual({ agentId: 'future-agent' });
    expect(resolveSessionAgentId(binding)).toBe('future-agent');
    expect(isExternalBackendBinding(binding)).toBe(true);
    expect(isAgentBackendId('future-agent')).toBe(false);
  });

  it('keeps only well-formed optional fields', () => {
    expect(
      parseSessionBackendBinding({
        agentId: 'grok',
        backendSessionId: 'abc',
        agentVersion: '1.0.44',
        syncedChangeUnixMs: 42,
        extra: 'ignored',
      }),
    ).toEqual({
      agentId: 'grok',
      backendSessionId: 'abc',
      agentVersion: '1.0.44',
      syncedChangeUnixMs: 42,
    });
    expect(
      parseSessionBackendBinding({
        agentId: 'grok',
        backendSessionId: 7,
        agentVersion: '',
        syncedChangeUnixMs: -1,
      }),
    ).toEqual({ agentId: 'grok' });
  });

  it('rejects malformed bindings', () => {
    expect(parseSessionBackendBinding(null)).toBeUndefined();
    expect(parseSessionBackendBinding('grok')).toBeUndefined();
    expect(parseSessionBackendBinding({ agentId: '  ' })).toBeUndefined();
    expect(parseSessionBackendBinding({})).toBeUndefined();
  });
});

describe('session backend capabilities', () => {
  it('Pi supports every operation', () => {
    const capabilities = createPiSessionCapabilities();
    for (const operation of SESSION_BACKEND_OPERATIONS) {
      expect(isSessionOperationSupported(capabilities, operation)).toBe(true);
    }
  });

  it('missing capabilities do not block legacy clients', () => {
    expect(isSessionOperationSupported(undefined, 'fork')).toBe(true);
    expect(sessionOperationUnsupportedReason(undefined, 'fork')).toBeUndefined();
  });

  it('reports the reason for an unsupported operation', () => {
    const capabilities: SessionBackendCapabilities = createPiSessionCapabilities();
    capabilities.operations.images = { supported: false, reason: 'no images' };
    expect(isSessionOperationSupported(capabilities, 'images')).toBe(false);
    expect(sessionOperationUnsupportedReason(capabilities, 'images')).toBe('no images');
  });

  it('treats absent nativeCli as unsupported without claiming Pi native CLI', () => {
    const capabilities = createPiSessionCapabilities();
    expect(isNativeCliSupported(undefined)).toBe(false);
    expect(isNativeCliSupported(capabilities)).toBe(false);
    expect(nativeCliUnsupportedReason(capabilities)).toMatch(/not available/i);
    expect(SESSION_BACKEND_OPERATIONS.includes('nativeCli' as never)).toBe(false);

    const withCli: SessionBackendCapabilities = {
      ...capabilities,
      nativeCli: { supported: true },
    };
    expect(isNativeCliSupported(withCli)).toBe(true);
    expect(nativeCliUnsupportedReason(withCli)).toBeUndefined();

    const denied: SessionBackendCapabilities = {
      ...capabilities,
      nativeCli: { supported: false, reason: 'no native TUI' },
    };
    expect(isNativeCliSupported(denied)).toBe(false);
    expect(nativeCliUnsupportedReason(denied)).toBe('no native TUI');
  });
});

describe('external agent native CLI readiness', () => {
  const base = {
    agentId: 'grok',
    binaryPath: '/usr/bin/grok',
    version: '1.0.0',
    supportStatus: 'verified' as const,
    checkedAt: '2026-10-12T00:00:00.000Z',
  };

  it('requires ready state even when unauthenticated advertises nativeCli', () => {
    const unauthenticated: ExternalAgentStatus = {
      ...base,
      state: 'unauthenticated',
      nativeCli: { supported: true },
    };
    const ready: ExternalAgentStatus = {
      ...base,
      state: 'ready',
      nativeCli: { supported: true },
    };
    const readyAbsent: ExternalAgentStatus = { ...base, state: 'ready' };
    expect(isExternalAgentNativeCliReady(unauthenticated)).toBe(false);
    expect(isExternalAgentNativeCliReady(ready)).toBe(true);
    expect(isExternalAgentNativeCliReady(readyAbsent)).toBe(false);
    expect(isExternalAgentNativeCliReady(undefined)).toBe(false);
  });
});

describe('backend permission options', () => {
  it('classifies ACP option kinds', () => {
    expect(isBackendPermissionOptionKind('allow_always')).toBe(true);
    expect(isBackendPermissionOptionKind('allow')).toBe(false);
    expect(isAllowPermissionOptionKind('allow_once')).toBe(true);
    expect(isAllowPermissionOptionKind('reject_once')).toBe(false);
  });
});
