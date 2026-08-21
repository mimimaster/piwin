import type { HostCommand, SettingsDomain } from '@piwin/contracts';
import { isRemoteSettingsApplyDomain } from '@piwin/contracts';

export function isSafeRemoteSettingsApply(command: Extract<HostCommand, { type: 'settings/apply' }>): boolean {
  const revision = command.input.expectedRevision;
  if (typeof revision !== 'string' || revision.length === 0 || revision.length > 256) {
    return false;
  }
  if (!Array.isArray(command.input.mutations) || command.input.mutations.length === 0) {
    return false;
  }
  if (command.input.mutations.length > 32) {
    return false;
  }
  for (const mutation of command.input.mutations) {
    if (mutation.kind !== 'replace-domain' || !isRemoteSettingsApplyDomain(mutation.domain)) {
      return false;
    }
    if (mutation.domain === 'permissions' && !isSafeRemotePermissionsValue(mutation.value)) {
      return false;
    }
    if (mutation.domain === 'providers' && !isSafeRemoteProvidersValue(mutation.value)) {
      return false;
    }
  }
  const expected = command.input.expectedDomainRevisions;
  if (expected === undefined) {
    return false;
  }
  for (const mutation of command.input.mutations) {
    const hash = expected[mutation.domain];
    if (typeof hash !== 'string' || hash.length === 0 || hash.length > 256) {
      return false;
    }
  }
  for (const [domain, hash] of Object.entries(expected) as Array<[SettingsDomain, string | undefined]>) {
    if (hash !== undefined && (hash.length === 0 || hash.length > 256)) {
      return false;
    }
    if (domain !== undefined && !isRemoteSettingsApplyDomain(domain)) {
      return false;
    }
  }
  return true;
}

/** Run Mode only: `{ mode, preset }`. Rule files stay on the Host disk. */
function isSafeRemotePermissionsValue(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'mode' && key !== 'preset') {
      return false;
    }
  }
  const mode = record.mode;
  const preset = record.preset;
  if (mode !== undefined && mode !== 'auto' && mode !== 'ask-all' && mode !== 'bypass') {
    return false;
  }
  if (preset !== undefined && preset !== 'ask' && preset !== 'auto' && preset !== 'yolo') {
    return false;
  }
  return true;
}

const FORBIDDEN_PROVIDER_SECRET_KEYS = new Set([
  'apikey',
  'secret',
  'token',
  'password',
  'authorization',
]);

/** Provider rows may carry refs (`apiKeyRef`) but not raw key material. */
function isSafeRemoteProvidersValue(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 64) {
    return false;
  }
  return !containsForbiddenSecretKey(value, 0);
}

function containsForbiddenSecretKey(value: unknown, depth: number): boolean {
  if (depth > 8 || value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenSecretKey(item, depth + 1));
  }
  if (typeof value !== 'object') {
    return false;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PROVIDER_SECRET_KEYS.has(key.toLowerCase())) {
      return true;
    }
    if (containsForbiddenSecretKey(nested, depth + 1)) {
      return true;
    }
  }
  return false;
}
