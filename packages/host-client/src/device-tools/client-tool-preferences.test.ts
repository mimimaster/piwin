import { describe, expect, it } from 'vitest';
import {
  applyConsentDecision,
  resolveForegroundGrant,
  type HealthConsentGrant,
} from './client-tool-preferences.js';

const ALWAYS: HealthConsentGrant = {
  mode: 'always-allow-this-host',
  alwaysAllowUnlocked: true,
  destinationFingerprint: 'external:openai',
};

describe('health consent grants', () => {
  it('does not let once wipe a durable always-allow mode', () => {
    expect(applyConsentDecision(ALWAYS, 'once', 'session-1')).toEqual(ALWAYS);
  });

  it('forces ask-every-time when provider facts are missing', () => {
    const grant = resolveForegroundGrant(ALWAYS, { sessionId: 'session-1' });
    expect(grant.mode).toBe('ask-every-time');
    expect(grant.alwaysAllowUnlocked).toBe(true);
  });

  it('does not honor always-allow stored without a destination fingerprint', () => {
    const grant = resolveForegroundGrant(
      { mode: 'always-allow-this-host', alwaysAllowUnlocked: true },
      { sessionId: 'session-1', destinationFingerprint: 'external:openai' },
    );
    expect(grant.mode).toBe('ask-every-time');
    expect(grant.alwaysAllowUnlocked).toBe(true);
    expect(grant.destinationFingerprint).toBe('external:openai');
  });

  it('honors always-allow when the provider fingerprint matches', () => {
    const grant = resolveForegroundGrant(ALWAYS, {
      sessionId: 'session-1',
      destinationFingerprint: 'external:openai',
    });
    expect(grant.mode).toBe('always-allow-this-host');
    expect(grant.alwaysAllowUnlocked).toBe(true);
  });

  it('invalidates always-allow when the provider fingerprint changes', () => {
    const grant = resolveForegroundGrant(ALWAYS, {
      sessionId: 'session-1',
      destinationFingerprint: 'local:ollama',
    });
    expect(grant.mode).toBe('ask-every-time');
    expect(grant.alwaysAllowUnlocked).toBe(false);
    expect(grant.destinationFingerprint).toBe('local:ollama');
  });
});
