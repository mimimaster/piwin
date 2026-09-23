import type { HostMode, HostPush } from '@piwin/contracts';
import { openCliHost } from './cli-host.js';
import { SideChatHostClient, bindSideChatHostClient } from './side-chat-command.js';
import { StudyHostClient, bindStudyHostClient } from './study-command.js';
import { WalkthroughHostClient } from './walkthrough-command.js';

/**
 * Host client construction shared by the subcommands that need one.
 */

export async function createStudyHostClient(
  mode: HostMode,
  mock: boolean,
): Promise<StudyHostClient> {
  const host = await openCliHost({ mode, mock });
  return bindStudyHostClient(host);
}

export async function createSideChatHostClient(
  mode: HostMode,
  mock: boolean,
): Promise<SideChatHostClient> {
  const pushHandlers = new Set<(message: HostPush) => void>();
  const host = await openCliHost({
    mode,
    mock,
    onPush: (message) => {
      for (const handler of pushHandlers) {
        handler(message);
      }
    },
  });
  return bindSideChatHostClient(host, pushHandlers);
}

export async function createWalkthroughHostClient(
  mode: HostMode,
  mock: boolean,
): Promise<WalkthroughHostClient> {
  const pushHandlers = new Set<(message: HostPush) => void>();
  const host = await openCliHost({
    mode,
    mock,
    onPush: (message) => {
      for (const handler of pushHandlers) {
        handler(message);
      }
    },
  });
  return {
    handleCommand: (command) => host.handleCommand(command),
    onPush: (handler) => {
      pushHandlers.add(handler);
      return () => {
        pushHandlers.delete(handler);
      };
    },
    dispose: () => host.dispose(),
  };
}
