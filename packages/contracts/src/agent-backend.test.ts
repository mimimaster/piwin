import { describe, expect, it } from 'vitest';
import {
  createPiSessionCapabilities,
  isAgentBackendId,
  isAllowPermissionOptionKind,
  isBackendPermissionOptionKind,
  isExternalBackendBinding,
  isSessionOperationSupported,
  parseSessionBackendBinding,
  resolveSessionAgentId,
  SESSION_BACKEND_OPERATIONS,
  sessionOperationUnsupportedReason,
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
});

describe('backend permission options', () => {
  it('classifies ACP option kinds', () => {
    expect(isBackendPermissionOptionKind('allow_always')).toBe(true);
    expect(isBackendPermissionOptionKind('allow')).toBe(false);
    expect(isAllowPermissionOptionKind('allow_once')).toBe(true);
    expect(isAllowPermissionOptionKind('reject_once')).toBe(false);
  });
});
