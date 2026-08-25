/**
 * Piwin Health foreground-use preferences, scoped by Host endpoint + paired
 * deviceId. Never keyed by hostInstanceId (that value rotates with a sidecar).
 */

export type HealthForegroundUseMode =
  | 'off'
  | 'ask-every-time'
  | 'allow-for-session'
  | 'always-allow-this-host';

export type HealthConsentGrant = {
  mode: HealthForegroundUseMode;
  sessionId?: string;
  alwaysAllowUnlocked: boolean;
  destinationFingerprint?: string;
};

export type ClientToolPreferenceStore = {
  read(scopeKey: string): HealthConsentGrant | undefined;
  write(scopeKey: string, grant: HealthConsentGrant): void;
  clear(scopeKey: string): void;
};

const DEFAULT_GRANT: HealthConsentGrant = {
  mode: 'ask-every-time',
  alwaysAllowUnlocked: false,
};

export function normalizeHostEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  const parsed = new URL(trimmed);
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}

export async function healthConsentScopeKey(endpoint: string, deviceId: string): Promise<string> {
  const material = `${normalizeHostEndpoint(endpoint)}\n${deviceId.trim()}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(material));
    return hexFromBuffer(digest);
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(material).digest('hex');
}

export function createMemoryClientToolPreferenceStore(): ClientToolPreferenceStore {
  const grants = new Map<string, HealthConsentGrant>();
  return {
    read(scopeKey) {
      return grants.get(scopeKey);
    },
    write(scopeKey, grant) {
      grants.set(scopeKey, grant);
    },
    clear(scopeKey) {
      grants.delete(scopeKey);
    },
  };
}

export function resolveForegroundGrant(
  stored: HealthConsentGrant | undefined,
  input: { sessionId: string; destinationFingerprint?: string },
): HealthConsentGrant {
  const grant = stored ?? DEFAULT_GRANT;
  const attachedFingerprint =
    input.destinationFingerprint === undefined
      ? {}
      : { destinationFingerprint: input.destinationFingerprint };
  if (grant.mode === 'off') {
    return {
      mode: 'off',
      alwaysAllowUnlocked: grant.alwaysAllowUnlocked,
      ...attachedFingerprint,
    };
  }
  const destinationFingerprint = input.destinationFingerprint;
  const fingerprintsMatch =
    destinationFingerprint !== undefined &&
    grant.destinationFingerprint === destinationFingerprint;
  if (!fingerprintsMatch) {
    const providerChanged =
      grant.destinationFingerprint !== undefined &&
      destinationFingerprint !== undefined &&
      grant.destinationFingerprint !== destinationFingerprint;
    return {
      mode: 'ask-every-time',
      alwaysAllowUnlocked: providerChanged ? false : grant.alwaysAllowUnlocked,
      ...attachedFingerprint,
    };
  }
  if (grant.mode === 'allow-for-session' && grant.sessionId !== input.sessionId) {
    return {
      mode: 'ask-every-time',
      alwaysAllowUnlocked: grant.alwaysAllowUnlocked,
      destinationFingerprint,
    };
  }
  return {
    ...grant,
    destinationFingerprint,
  };
}

export function applyConsentDecision(
  current: HealthConsentGrant,
  decision: 'deny' | 'once' | 'session' | 'always',
  sessionId: string,
): HealthConsentGrant {
  if (decision === 'deny') {
    return current;
  }
  if (decision === 'once') {
    return current;
  }
  if (decision === 'session') {
    return { ...current, mode: 'allow-for-session', sessionId };
  }
  if (decision === 'always' && current.alwaysAllowUnlocked) {
    return { ...current, mode: 'always-allow-this-host' };
  }
  return current;
}

export function markSuccessfulExplicitRead(grant: HealthConsentGrant): HealthConsentGrant {
  return { ...grant, alwaysAllowUnlocked: true };
}

function hexFromBuffer(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
