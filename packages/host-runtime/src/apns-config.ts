import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { getPiwinRoot } from './paths.js';

export const APNS_CONFIG_FILENAME = 'apns.json';

export type ApnsEnvironment = 'sandbox' | 'production';

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  keyPath: string;
  environment: ApnsEnvironment;
};

export function getApnsConfigPath(piwinRoot?: string): string {
  return join(getPiwinRoot(piwinRoot), APNS_CONFIG_FILENAME);
}

/**
 * Empty or partial `~/.piwin/apns.json` means APNs is off.
 * Never returns or logs the `.p8` contents.
 */
export function readApnsConfig(piwinRoot?: string): ApnsConfig | null {
  const configPath = getApnsConfigPath(piwinRoot);
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const keyId = readNonEmptyString(record.keyId);
  const teamId = readNonEmptyString(record.teamId);
  const bundleId = readNonEmptyString(record.bundleId);
  const keyPathRaw = readNonEmptyString(record.keyPath);
  const environment = readEnvironment(record.environment);
  if (keyId === null || teamId === null || bundleId === null || keyPathRaw === null || environment === null) {
    return null;
  }
  const keyPath = isAbsolute(keyPathRaw)
    ? keyPathRaw
    : join(getPiwinRoot(piwinRoot), keyPathRaw);
  return { keyId, teamId, bundleId, keyPath, environment };
}

export function isApnsConfigured(piwinRoot?: string): boolean {
  return readApnsConfig(piwinRoot) !== null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnvironment(value: unknown): ApnsEnvironment | null {
  if (value === 'sandbox' || value === 'production') {
    return value;
  }
  if (value === undefined || value === '') {
    return 'sandbox';
  }
  return null;
}
