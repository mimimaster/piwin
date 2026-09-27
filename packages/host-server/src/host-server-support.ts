import { timingSafeEqual } from 'node:crypto';
import type {
  HostHydrationFrame,
  RemoteSessionSummary,
  RemoteTranscriptMessage,
} from '@piwin/contracts';
import { LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';

import { projectRemoteResponse } from './remote-projection.js';
import { isRecord } from './remote-record-guard.js';

// Remote command payload validation, media-ref bookkeeping, and the shared
// record guard were split into their own modules (AGENTS.md §3.2). They stay
// re-exported here so existing importers keep this module as their entry point.
export { isRecord } from './remote-record-guard.js';
export {
  MAX_REMOTE_MEDIA_BASE64_CHARS,
  MAX_REMOTE_MEDIA_REFS,
  collectMediaRefs,
  rememberRemoteMediaAsset,
  rememberRemoteMediaRefsFromPush,
  resolveRemoteCommand,
} from './remote-media-refs.js';
export {
  isSafeQueuedTurnCommand,
  isSafeRemoteAttachment,
  isSafeRemoteCommand,
  isSafeRemoteId,
  isSafeRemoteProjectLocator,
  isSafeRemoteSessionListPageScope,
  isSafeRemoteSessionListScopeRef,
  isSafeTrustedTextRelativePath,
} from './remote-command-validation.js';

export const MAX_HYDRATION_SESSIONS = 200;
export const MAX_HYDRATION_SUBSCRIPTIONS = LIVE_SUBSCRIPTION_MAX_SESSION_IDS;
export const MAX_HYDRATION_MESSAGES_PER_SESSION = 16;
export const MAX_HYDRATION_TEXT_BYTES = 16 * 1024;
export const MAX_HYDRATION_THINKING_BYTES = 8 * 1024;
export const MAX_HYDRATION_FRAME_BYTES = 900 * 1024;

export function normalizeSeq(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

export function isLoopbackBrowserOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'tauri:') {
      return host === 'localhost' || host === '127.0.0.1';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host === 'tauri.localhost'
    );
  } catch {
    return false;
  }
}

export function authTokensEqual(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) {
    return false;
  }
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function formatWebSocketUrl(host: string, port: number): string {
  // Wildcard binds are not dialable; advertise loopback so local shells can connect.
  const dialHost = isWildcardHost(host) ? '127.0.0.1' : host;
  const displayHost =
    dialHost.includes(':') && !dialHost.startsWith('[') ? `[${dialHost}]` : dialHost;
  return `ws://${displayHost}:${port}`;
}

export function requestIdFromSerializedWire(serialized: string): string | undefined {
  try {
    const preview = decodeHostWireMessage(serialized);
    if (preview.type === 'command' && typeof preview.requestId === 'string') {
      return preview.requestId;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function normalizeHydrationSessionIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of value) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    result.push(sessionId);
    if (result.length >= MAX_HYDRATION_SUBSCRIPTIONS) break;
  }
  return result;
}

export function isRemoteSessionSummary(value: unknown): value is RemoteSessionSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === 'string' &&
    (value.scope === 'general' || value.scope === 'project' || value.scope === 'unknown')
  );
}

export function limitHydrationMessage(message: RemoteTranscriptMessage): RemoteTranscriptMessage {
  const limited: RemoteTranscriptMessage = {
    ...message,
    text: truncateUtf8(message.text, MAX_HYDRATION_TEXT_BYTES),
  };
  if (message.thinking !== undefined) {
    limited.thinking = truncateUtf8(message.thinking, MAX_HYDRATION_THINKING_BYTES);
  }
  if (message.tools !== undefined && message.tools.length > 0) {
    limited.tools = message.tools.slice(0, 8).map((tool) => ({
      ...tool,
      output: truncateUtf8(tool.output, 2 * 1024),
    }));
  }
  return limited;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return value;
  let candidate = value.slice(0, maxBytes);
  while (candidate.length > 0 && new TextEncoder().encode(`${candidate}…`).byteLength > maxBytes) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate}…`;
}

export function fitHydrationFrame(frame: HostHydrationFrame): HostHydrationFrame {
  let candidate = frame;
  while (true) {
    try {
      const encoded = encodeHostWireMessage(candidate);
      if (new TextEncoder().encode(encoded).byteLength <= MAX_HYDRATION_FRAME_BYTES) {
        return candidate;
      }
    } catch {
      // Trim below and retry. The resulting frame remains explicit and bounded.
    }

    const messageSessionIds = Object.keys(candidate.snapshot.messagesBySession);
    const removableSessionId = messageSessionIds.at(-1);
    if (removableSessionId !== undefined) {
      const messagesBySession = { ...candidate.snapshot.messagesBySession };
      delete messagesBySession[removableSessionId];
      candidate = {
        ...candidate,
        snapshot: {
          ...candidate.snapshot,
          messagesBySession,
          truncatedSessionIds: [
            ...new Set([...candidate.snapshot.truncatedSessionIds, removableSessionId]),
          ],
        },
      };
      continue;
    }

    if (candidate.snapshot.sessions.length > 0) {
      candidate = {
        ...candidate,
        snapshot: {
          ...candidate.snapshot,
          sessions: candidate.snapshot.sessions.slice(0, -1),
        },
      };
      continue;
    }

    return {
      ...candidate,
      snapshot: { ...candidate.snapshot, messagesBySession: {}, sessions: [] },
    };
  }
}
