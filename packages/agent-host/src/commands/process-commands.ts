/**
 * Host IPC handlers: process.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'process/list',
  'process/get',
  'process/start',
  'process/logs',
  'process/stop',
]);

export function isProcessCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handleProcessCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'process/list': {
          const registry = context.getProcessRegistry();
          const filter: { sessionId?: string; projectPath?: string } = {};
          if (command.sessionId) filter.sessionId = command.sessionId;
          if (command.projectPath) filter.projectPath = command.projectPath;
          const processes = registry.list(
            Object.keys(filter).length > 0 ? filter : undefined,
          );
          return ok(requestId, 'process/list', { processes });
        }
        case 'process/get': {
          const registry = context.getProcessRegistry();
          const processRecord = registry.get(command.processId);
          if (!processRecord) {
            return fail(requestId, 'process/get', `Unknown process: ${command.processId}`);
          }
          return ok(requestId, 'process/get', { process: processRecord });
        }
        case 'process/start': {
          // IPC start is host-authoritative (Desktop/CLI). Agent tools gate via process:start ask.
          const registry = context.getProcessRegistry();
          const processRecord = await registry.start(command.input);
          return ok(requestId, 'process/start', { process: processRecord });
        }
        case 'process/logs': {
          const registry = context.getProcessRegistry();
          const chunks = registry.readLogs(command.query);
          return ok(requestId, 'process/logs', {
            processId: command.query.processId,
            chunks,
          });
        }
        case 'process/stop': {
          // UI Stop is explicit user intent; tools still gate via process:stop ask.
          const registry = context.getProcessRegistry();
          const processRecord = await registry.stop(command.processId);
          return ok(requestId, 'process/stop', { process: processRecord });
        }

    default:
      return null;
  }
}
