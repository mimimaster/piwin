import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import {
  AcpClient,
  GROK_DROPPED_NOTIFICATION_METHODS,
  JsonRpcConnection,
  type AcpLineTransport,
} from '@piwin/acp-agent';
import type { ExternalAgentStatus } from '@piwin/contracts';
import { GrokSessionOptionsState } from '@piwin/acp-agent';
import { createGrokProcessTransport } from './grok-process-transport.js';

export const GROK_VERIFIED_VERSIONS: ReadonlySet<string> = new Set(['1.0.41', '1.0.44']);

const AGENT_ID = 'grok';
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const UNAVAILABLE_REASON_MAX = 200;

export function resolveGrokBinaryCandidates(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined): void => {
    if (value === undefined || value.length === 0 || seen.has(value)) {
      return;
    }
    seen.add(value);
    candidates.push(value);
  };

  push(env.PIWIN_GROK_BIN);
  const pathApi = platform === 'win32' ? win32 : posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  const binaryName = platform === 'win32' ? 'grok.exe' : 'grok';
  const pathValue = env.PATH ?? '';
  for (const entry of pathValue.split(delimiter)) {
    if (entry.length === 0) {
      continue;
    }
    push(pathApi.join(entry, binaryName));
  }
  push(pathApi.join(homeDir, '.grok', 'bin', 'grok'));
  return candidates;
}

export type DetectGrokCliOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => Promise<boolean>;
  createTransport?: (binaryPath: string) => AcpLineTransport & { close(): Promise<void> };
  handshakeTimeoutMs?: number;
  now?: () => string;
};

export async function detectGrokCli(options: DetectGrokCliOptions = {}): Promise<ExternalAgentStatus> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? pathExistsExecutable;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const checkedAt = (options.now ?? isoNow)();
  const searched = resolveGrokBinaryCandidates(env, homeDir, platform);

  let binaryPath: string | undefined;
  for (const candidate of searched) {
    if (await fileExists(candidate)) {
      binaryPath = candidate;
      break;
    }
  }
  if (binaryPath === undefined) {
    return { agentId: AGENT_ID, state: 'not-installed', searched, checkedAt };
  }

  const createTransport =
    options.createTransport ??
    ((path: string) => createGrokProcessTransport({ binaryPath: path, env }));
  let connection: JsonRpcConnection | undefined;
  let status: ExternalAgentStatus;
  try {
    connection = new JsonRpcConnection(createTransport(binaryPath), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: handshakeTimeoutMs,
    });
    const result = await new AcpClient(connection).initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'piwin', version: '0' },
    });
    status = statusFromInitialize(result, binaryPath, checkedAt);
  } catch (error) {
    status = {
      agentId: AGENT_ID,
      state: 'unavailable',
      binaryPath,
      reason: formatUnavailableReason(error),
      checkedAt,
    };
  } finally {
    if (connection !== undefined) {
      // Handshake process is discarded; a close failure cannot change the computed status.
      await connection.close().catch(() => undefined);
    }
  }
  return status;
}

function statusFromInitialize(
  result: {
    authMethods?: Array<{ id: string }>;
    _meta?: Record<string, unknown>;
  },
  binaryPath: string,
  checkedAt: string,
): ExternalAgentStatus {
  const meta = result._meta ?? {};
  const version = meta.agentVersion;
  if (typeof version !== 'string' || version.length === 0) {
    return {
      agentId: AGENT_ID,
      state: 'unavailable',
      binaryPath,
      reason: 'agent did not report a version',
      checkedAt,
    };
  }
  const defaultAuthMethodId =
    typeof meta.defaultAuthMethodId === 'string' ? meta.defaultAuthMethodId : undefined;
  const authenticated =
    defaultAuthMethodId === 'cached_token' ||
    result.authMethods === undefined ||
    result.authMethods.length === 0;
  const status: Extract<ExternalAgentStatus, { state: 'ready' | 'unauthenticated' }> = {
    agentId: AGENT_ID,
    state: authenticated ? 'ready' : 'unauthenticated',
    binaryPath,
    version,
    supportStatus: GROK_VERIFIED_VERSIONS.has(version) ? 'verified' : 'unverified',
    checkedAt,
  };
  if (defaultAuthMethodId !== undefined) {
    status.defaultAuthMethodId = defaultAuthMethodId;
  }
  // Agent-level defaults so the new-session picker has models/commands
  // before any Grok session exists.
  const options = new GrokSessionOptionsState();
  options.applyModels(meta.modelState);
  if (Array.isArray(meta.availableCommands)) {
    options.applyCommands(meta.availableCommands);
  }
  status.options = options.snapshot(AGENT_ID);
  return status;
}

function formatUnavailableReason(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
  return text.length <= UNAVAILABLE_REASON_MAX ? text : text.slice(0, UNAVAILABLE_REASON_MAX);
}

async function pathExistsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isoNow(): string {
  return new Date().toISOString();
}
