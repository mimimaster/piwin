import { redactRemoteHostPaths } from './remote-redact.js';
import type { RemoteTranscriptMessage } from '@piwin/contracts';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function copyString<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
): void {
  const value = source[sourceKey];
  if (typeof value === 'string' && value.length > 0) {
    target[targetKey] = value as T[keyof T];
  }
}

export function copyNumber<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
): void {
  const value = source[sourceKey];
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[targetKey] = value as T[keyof T];
  }
}

export function copyBoundedString<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
  maxBytes: number,
): void {
  const value = source[sourceKey];
  if (typeof value === 'string' && value.length > 0) {
    target[targetKey] = boundedString(value, maxBytes) as T[keyof T];
  }
}

export function boundedString(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return `${value.slice(0, Math.max(0, Math.floor(maxBytes / 2)))}…`;
}

export function safeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function isAgentMessageRole(value: unknown): value is RemoteTranscriptMessage['role'] {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool';
}

export function isTranscriptStatus(value: unknown): value is RemoteTranscriptMessage['status'] {
  return value === 'streaming' || value === 'done' || value === 'error';
}

export function isTranscriptOutcome(
  value: unknown,
): value is NonNullable<RemoteTranscriptMessage['outcome']> {
  return value === 'completed' || value === 'cancelled' || value === 'failed';
}

export function redactHostError(error: string): string {
  return redactRemoteHostPaths(error);
}

export function isRemoteAssetRef(value: string): boolean {
  if (!value.startsWith('remote-asset:')) return false;
  const assetId = value.slice('remote-asset:'.length);
  return assetId.length > 0 && assetId.length <= 256 && !/[\\/\u0000-\u001f]/.test(assetId);
}

export function projectRemoteMediaRef(
  value: string,
  remoteMediaPaths: ReadonlyMap<string, string> | undefined,
): string {
  if (isRemoteAssetRef(value)) {
    return value;
  }
  for (const [assetId, absolutePath] of remoteMediaPaths ?? []) {
    if (absolutePath === value && assetId.length > 0 && assetId.length <= 256) {
      return `remote-asset:${assetId}`;
    }
  }
  return '[host-path]';
}
