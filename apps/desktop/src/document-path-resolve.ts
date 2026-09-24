/**
 * Client for `preview/resolve-path` (ADR 0052 §6).
 *
 * Desktop sends the raw clicked text once and the Host answers with a logical
 * target — or with a specific reason and the routes it tried. The client stops
 * guessing: it cannot know the Host user's home, the Host config root, realpath
 * aliases, or whether it is running beside the Host.
 *
 * `unsupported` keeps older Hosts working: the caller falls back to its local
 * planner instead of showing an "Unhandled command" failure.
 */
import type {
  DocumentPathAttempt,
  DocumentPathFailureReason,
  DocumentTargetRef,
} from '@piwin/contracts';
import type { HostClient } from './host-client.js';

/** Minimal Host seam (test doubles provide only what they exercise). */
export type DocumentPathResolveHost = {
  request: HostClient['request'];
  supportsCommand?: ((type: 'preview/resolve-path') => boolean) | undefined;
};

export type DocumentPathResolution =
  | { kind: 'resolved'; target: DocumentTargetRef; attempts: DocumentPathAttempt[] }
  | { kind: 'unresolved'; reason: DocumentPathFailureReason; attempts: DocumentPathAttempt[] }
  /** The Host does not implement the command; use the local planner. */
  | { kind: 'unsupported' };

const FAILURE_REASONS: readonly DocumentPathFailureReason[] = [
  'empty-path',
  'invalid-path',
  'not-found',
  'not-a-file',
  'outside-domains',
  'ambiguous-file',
  'project-root-missing',
  'remote-local-path-denied',
];

const TARGET_KINDS = new Set<DocumentTargetRef['kind']>([
  'project-file',
  'skill',
  'media',
  'trusted-config',
  'local-file',
]);

/**
 * True when the Host advertised the command. A Host that omits its ceiling
 * (the local sidecar, or the operator) supports it; a shell talking to a later
 * Host version is decided by `allowedCommands`.
 */
export function hostResolvesDocumentPaths(host: DocumentPathResolveHost): boolean {
  return host.supportsCommand?.('preview/resolve-path') === true;
}

export async function requestDocumentPathResolution(
  host: DocumentPathResolveHost,
  input: { rawPath: string; projectPath?: string | undefined; sessionId?: string | undefined },
): Promise<DocumentPathResolution> {
  let response;
  try {
    response = await host.request({
      type: 'preview/resolve-path',
      input: {
        rawPath: input.rawPath,
        ...(input.projectPath ? { projectPath: input.projectPath } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    });
  } catch {
    return { kind: 'unsupported' };
  }
  if (!response.success || response.data === undefined) {
    return { kind: 'unsupported' };
  }
  return parseResolution(response.data);
}

/** Never trust the wire: an answer we cannot read is "ask the old planner". */
export function parseResolution(data: unknown): DocumentPathResolution {
  if (typeof data !== 'object' || data === null) {
    return { kind: 'unsupported' };
  }
  const record = data as {
    status?: unknown;
    target?: unknown;
    reason?: unknown;
    attempts?: unknown;
  };
  const attempts = parseAttempts(record.attempts);
  if (record.status === 'resolved') {
    const target = parseTarget(record.target);
    return target ? { kind: 'resolved', target, attempts } : { kind: 'unsupported' };
  }
  if (record.status === 'unresolved') {
    const reason = record.reason;
    if (
      typeof reason === 'string' &&
      FAILURE_REASONS.includes(reason as DocumentPathFailureReason)
    ) {
      return { kind: 'unresolved', reason: reason as DocumentPathFailureReason, attempts };
    }
  }
  return { kind: 'unsupported' };
}

function parseAttempts(value: unknown): DocumentPathAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attempts: DocumentPathAttempt[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { route?: unknown; reason?: unknown; detail?: unknown };
    if (typeof record.route !== 'string' || typeof record.reason !== 'string') continue;
    attempts.push({
      route: record.route as DocumentPathAttempt['route'],
      reason: record.reason,
      ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
    });
  }
  return attempts;
}

function parseTarget(value: unknown): DocumentTargetRef | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || !TARGET_KINDS.has(kind as DocumentTargetRef['kind'])) {
    return null;
  }
  const displayRef = typeof record.displayRef === 'string' ? record.displayRef : '';
  switch (kind as DocumentTargetRef['kind']) {
    case 'project-file':
      return typeof record.relativePath === 'string'
        ? { kind: 'project-file', relativePath: record.relativePath, displayRef }
        : null;
    case 'skill':
      return typeof record.skillId === 'string'
        ? { kind: 'skill', skillId: record.skillId, displayRef }
        : null;
    case 'media':
      return typeof record.sessionId === 'string' && typeof record.assetId === 'string'
        ? { kind: 'media', sessionId: record.sessionId, assetId: record.assetId, displayRef }
        : null;
    case 'trusted-config':
      return typeof record.relativePath === 'string'
        ? { kind: 'trusted-config', relativePath: record.relativePath, displayRef }
        : null;
    case 'local-file':
      return typeof record.absolutePath === 'string' && record.absolutePath.length > 0
        ? { kind: 'local-file', absolutePath: record.absolutePath, displayRef }
        : null;
    default:
      return null;
  }
}
