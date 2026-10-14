/**
 * Host-owned native agent terminal contracts.
 *
 * Executable path, trusted cwd, env and spawn stay on the Host. Clients may
 * only name an external backend id, an optional product session/project, and a
 * bounded terminal grid. Ownership below is Host-managed for one product
 * session (Desktop vs attached native PTY writer), not an OS-wide CLI lease.
 */
import { isAgentPluginId } from './agent-plugin-manifest.js';

export type AgentCliActivity = 'unknown' | 'idle' | 'running' | 'waiting';

export type AgentCliOpenInput = {
  /** External backend id (`isAgentPluginId`). Pi is not a native-CLI agent id. */
  agentId: string;
  sessionId?: string;
  /** Local project path or opaque remote project id; ignored for a resumed session. */
  projectPath?: string;
  cols: number;
  rows: number;
};

/** Open response stays backward compatible with the Grok-era shape. */
export type AgentCliOpenData = {
  ptyId: string;
  sessionId: string;
  /** Bounded terminal replay for this attaching client only. */
  initialOutput?: string;
  initialOutputThrough?: number;
  /** Host-managed writer ownership; clients never set this. */
  ownership?: AgentCliOwnership;
};

/** Sync / status responses may echo ownership without disclosing binary/env. */
export type AgentCliSyncData = {
  sessionId: string;
  ownership?: AgentCliOwnership;
};

export type AgentCliStatusData = {
  ownership: AgentCliOwnership;
};

/**
 * Host-managed writer ownership for one product session.
 * Not a durable OS lock and not a standalone CLI process lease.
 */
export type AgentCliOwnership =
  | { kind: 'desktop'; sessionId: string }
  | { kind: 'native'; sessionId: string; ptyId: string; activity?: AgentCliActivity }
  | { kind: 'switching'; sessionId: string; target: 'desktop' | 'native'; ptyId?: string };

export const AGENT_CLI_FAILURE_CODES = [
  'cli-unsupported',
  'not-ready',
  'session-unavailable',
  'writer-busy',
  'transition-failed',
] as const;

export type AgentCliFailureCode = (typeof AGENT_CLI_FAILURE_CODES)[number];

export type AgentCliHostCommand =
  | { id?: string; type: 'agents/cli-open'; input: AgentCliOpenInput }
  /** Read a native snapshot when preserving the writer; otherwise hand off to Desktop. */
  | { id?: string; type: 'agents/cli-sync'; sessionId: string; preserveNative?: boolean }
  /** Explicit read-only view refresh; older Hosts must reject rather than perform a handoff. */
  | { id?: string; type: 'agents/cli-snapshot'; sessionId: string }
  /** Read Host-managed writer ownership for one product session. */
  | { id?: string; type: 'agents/cli-status'; sessionId: string };

export const AGENT_CLI_MAX_INPUT_CHARS = 64 * 1024;
export const AGENT_CLI_MAX_SESSION_ID_CHARS = 256;
export const AGENT_CLI_MAX_PROJECT_PATH_CHARS = 4096;

const AGENT_CLI_OPEN_KEYS = ['agentId', 'sessionId', 'projectPath', 'cols', 'rows'] as const;
const AGENT_CLI_FAILURE_CODE_SET: ReadonlySet<string> = new Set(AGENT_CLI_FAILURE_CODES);

export function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return typeof cols === 'number' && Number.isSafeInteger(cols) && cols >= 2 && cols <= 1000 &&
    typeof rows === 'number' && Number.isSafeInteger(rows) && rows >= 1 && rows <= 500;
}

export function isAgentCliFailureCode(value: unknown): value is AgentCliFailureCode {
  return typeof value === 'string' && AGENT_CLI_FAILURE_CODE_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedOptionalText(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars && !value.includes('\0');
}

/**
 * Syntactic open-input gate only. Does not prove the Host installed, trusted,
 * or readiness-checked the named backend (that is a later Host step).
 */
export function isAgentCliOpenInput(value: unknown): value is AgentCliOpenInput {
  if (!isRecord(value) || !hasOnlyKeys(value, AGENT_CLI_OPEN_KEYS)) {
    return false;
  }
  if (!isAgentPluginId(value.agentId) || !isValidTerminalSize(value.cols, value.rows)) {
    return false;
  }
  if (value.sessionId !== undefined && !isBoundedOptionalText(value.sessionId, AGENT_CLI_MAX_SESSION_ID_CHARS)) {
    return false;
  }
  if (value.projectPath !== undefined && !isBoundedOptionalText(value.projectPath, AGENT_CLI_MAX_PROJECT_PATH_CHARS)) {
    return false;
  }
  return true;
}

export function isAgentCliOwnership(value: unknown): value is AgentCliOwnership {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.sessionId !== 'string' ||
      value.sessionId.length === 0 || value.sessionId.length > AGENT_CLI_MAX_SESSION_ID_CHARS ||
      value.sessionId.includes('\0')) {
    return false;
  }
  if (value.kind === 'desktop') {
    return hasOnlyKeys(value, ['kind', 'sessionId']);
  }
  if (value.kind === 'native') {
    return hasOnlyKeys(value, ['kind', 'sessionId', 'ptyId', 'activity']) &&
      (value.activity === undefined || value.activity === 'unknown' || value.activity === 'idle' || value.activity === 'running' || value.activity === 'waiting') &&
      typeof value.ptyId === 'string' && value.ptyId.length > 0 &&
      value.ptyId.length <= AGENT_CLI_MAX_SESSION_ID_CHARS && !value.ptyId.includes('\0');
  }
  if (value.kind === 'switching') {
    if ((value.target !== 'desktop' && value.target !== 'native') ||
        !hasOnlyKeys(value, ['kind', 'sessionId', 'target', 'ptyId'])) {
      return false;
    }
    if (value.ptyId === undefined) {
      return true;
    }
    return typeof value.ptyId === 'string' && value.ptyId.length > 0 &&
      value.ptyId.length <= AGENT_CLI_MAX_SESSION_ID_CHARS && !value.ptyId.includes('\0');
  }
  return false;
}

/** Desktop prompt admission is blocked while native owns the session or a handoff is in flight. */
export function isAgentCliDesktopWriterBlocked(ownership: AgentCliOwnership): boolean {
  return ownership.kind === 'native' || ownership.kind === 'switching';
}
