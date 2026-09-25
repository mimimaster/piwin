import {
  createMockUsageCallLog,
  createMockUsageRollup,
} from './host-client-mock-helpers.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  WebSearchLogEntry,
} from '@piwin/contracts';

/** Browser-shell sample of the cross-session search log; clearable per page load. */
let mockWebSearchLog: WebSearchLogEntry[] = createMockWebSearchLog();

function createMockWebSearchLog(): WebSearchLogEntry[] {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  return [
    {
      id: 'mock-search-3',
      recordedAt: at(2),
      sessionId: 'session-mock-a',
      query: 'tauri webkit iframe sandbox',
      ok: true,
      providerId: 'aggregate:brave+tavily',
      hitCount: 6,
      durationMs: 5010,
      attempts: [
        {
          sourceId: 'brave',
          ok: false,
          hitCount: 0,
          durationMs: 5002,
          timedOut: true,
          error: 'source "brave" timed out after 5000ms',
        },
        { sourceId: 'tavily', ok: true, hitCount: 6, durationMs: 1240 },
      ],
    },
    {
      id: 'mock-search-2',
      recordedAt: at(18),
      sessionId: 'session-mock-b',
      query: 'pnpm workspace catalog protocol',
      ok: false,
      providerId: 'brave',
      hitCount: 0,
      durationMs: 312,
      attempts: [
        {
          sourceId: 'brave',
          ok: false,
          hitCount: 0,
          durationMs: 312,
          error: 'Brave search failed: HTTP 429',
        },
      ],
      error: 'Brave search failed: HTTP 429',
    },
    {
      id: 'mock-search-1',
      recordedAt: at(95),
      sessionId: 'session-mock-a',
      query: 'FSRS stability difficulty parameters',
      ok: true,
      providerId: 'aggregate:brave+tavily',
      hitCount: 8,
      durationMs: 1430,
      attempts: [
        { sourceId: 'brave', ok: true, hitCount: 5, durationMs: 980 },
        { sourceId: 'tavily', ok: true, hitCount: 6, durationMs: 1420 },
      ],
    },
  ];
}

export async function handleMockHostCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'host/ping':
        return { id, type: 'response', command: 'host/ping', success: true, data: { pong: true } };
      case 'host/list-dir': {
        const homePath = '/Users/mock';
        const current = command.path?.trim() || homePath;
        return {
          id,
          type: 'response',
          command: 'host/list-dir',
          success: true,
          data: {
            path: current,
            parentPath: current === homePath ? '/' : homePath,
            homePath,
            entries:
              current === homePath
                ? [
                    { name: 'Applications', kind: 'directory', path: `${homePath}/Applications` },
                    { name: 'Desktop', kind: 'directory', path: `${homePath}/Desktop` },
                    { name: 'Developer', kind: 'directory', path: `${homePath}/Developer` },
                    { name: 'Documents', kind: 'directory', path: `${homePath}/Documents` },
                    { name: 'Downloads', kind: 'directory', path: `${homePath}/Downloads` },
                    { name: 'Projects', kind: 'directory', path: `${homePath}/Projects` },
                    ...(command.includeHidden
                      ? [{ name: '.piwin', kind: 'directory' as const, path: `${homePath}/.piwin` }]
                      : []),
                  ]
                : current === `${homePath}/.piwin`
                  ? [
                      {
                        name: 'search.mjs',
                        kind: 'file' as const,
                        path: `${homePath}/.piwin/search.mjs`,
                      },
                    ]
                  : current === `${homePath}/Developer`
                    ? [
                        { name: 'piwin', kind: 'directory', path: `${homePath}/Developer/piwin` },
                        { name: 'notes.md', kind: 'file', path: `${homePath}/Developer/notes.md` },
                      ]
                    : [],
          },
        };
      }
      case 'host/status':
        return {
          id,
          type: 'response',
          command: 'host/status',
          success: true,
          data: {
            mode: host.getMode(),
            ready: true,
            mock: true,
            piwinRoot: '~/.piwin',
            generalWorkspacePath: '~/.piwin/workspace',
            activeSessionIds: [...host.sessions.keys()],
            capabilities: host.contextTelemetry.attachCapabilities({
              customTools: true,
              mcpLifecycle: true,
              productTranscript: true,
              compaction: true,
              extensions: true,
              prompts: true,
              process: true,
              sessionSearch: true,
              sessionPin: true,
              sessionLifecycle: true,
              sessionPause: true,
              runInterventions: true,
              queuedTurns: true,
              sessionUserMessageIndex: true,
              sessionTranscriptSeek: true,
              sessionExport: true,
              usage: true,
              pty: false,
              subagentWorktree: true,
              marketplaceHub: true,
              automation: true,
              flashcardStudy: true,
              knowledgeBases: true,
            }),
          },
        };
      case 'web/search-log-list': {
        const filtered =
          command.status === 'failed'
            ? mockWebSearchLog.filter(
                (entry) => !entry.ok || entry.attempts.some((attempt) => !attempt.ok),
              )
            : mockWebSearchLog;
        const limit = command.limit ?? 50;
        const offset = command.offset ?? 0;
        return {
          id,
          type: 'response',
          command: 'web/search-log-list',
          success: true,
          data: {
            page: {
              entries: filtered.slice(offset, offset + limit),
              total: filtered.length,
              offset,
              limit,
            },
          },
        };
      }
      case 'web/search-log-clear':
        mockWebSearchLog = [];
        return { id, type: 'response', command: 'web/search-log-clear', success: true, data: {} };
      case 'usage/get-rollup':
        return {
          id,
          type: 'response',
          command: 'usage/get-rollup',
          success: true,
          data: { rollup: createMockUsageRollup(command.projectPath) },
        };
      case 'usage/list-recent':
        return {
          id,
          type: 'response',
          command: 'usage/list-recent',
          success: true,
          data: {
            log: createMockUsageCallLog(
              command.projectPath,
              command.windowMinutes ?? 60,
              command.limit ?? 200,
              command.offset ?? 0,
            ),
          },
        };
      case 'host/pairing-status':
        return {
          id,
          type: 'response',
          command: 'host/pairing-status',
          success: true,
          data: {
            enabled: true,
            canManage: true,
            pairedDeviceCount: 0,
            hostInstanceId: 'mock-host',
            advertisedEndpoint: 'ws://127.0.0.1:8787',
          },
        };
      case 'host/pairing-create-code':
        return {
          id,
          type: 'response',
          command: 'host/pairing-create-code',
          success: true,
          data: {
            pairingToken: 'mock-token',
            uri: 'piwin://pair?endpoint=ws%3A%2F%2F127.0.0.1%3A8787&token=mock-token',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            endpoint: 'ws://127.0.0.1:8787',
            hostInstanceId: 'mock-host',
          },
        };
      case 'host/pairing-list-devices':
        return {
          id,
          type: 'response',
          command: 'host/pairing-list-devices',
          success: true,
          data: {
            devices: [],
          },
        };
      case 'host/pairing-revoke-device':
        return {
          id,
          type: 'response',
          command: 'host/pairing-revoke-device',
          success: true,
          data: {
            revoked: true,
          },
        };
    default:
      return null;
  }
}

