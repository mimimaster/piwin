/**
 * Host IPC handlers: pty.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'pty/open',
  'pty/write',
  'pty/resize',
  'pty/close',
  'pty/list',
]);

export function isPtyCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handlePtyCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'pty/open': {
          const host = context.getPtyHost();
          const summary = await host.open(command.input);
          return ok(requestId, 'pty/open', { pty: summary });
        }
        case 'pty/write': {
          context.getPtyHost().write(command.ptyId, command.data);
          return ok(requestId, 'pty/write', { ptyId: command.ptyId });
        }
        case 'pty/resize': {
          context.getPtyHost().resize(command.ptyId, command.cols, command.rows);
          return ok(requestId, 'pty/resize', { ptyId: command.ptyId });
        }
        case 'pty/close': {
          context.getPtyHost().close(command.ptyId);
          return ok(requestId, 'pty/close', { ptyId: command.ptyId });
        }
        case 'pty/list': {
          const list = context.getPtyHost().list(command.projectPath);
          return ok(requestId, 'pty/list', { sessions: list });
        }

    default:
      return null;
  }
}
