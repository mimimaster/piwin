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

