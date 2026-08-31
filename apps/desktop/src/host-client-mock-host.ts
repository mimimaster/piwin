import {
  createMockUsageRollup,
} from './host-client-mock-helpers.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
} from '@piwin/contracts';

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
            }),
          },
        };
      case 'usage/get-rollup':
        return {
          id,
          type: 'response',
          command: 'usage/get-rollup',
          success: true,
          data: { rollup: createMockUsageRollup(command.projectPath) },
        };
    default:
      return null;
  }
}

