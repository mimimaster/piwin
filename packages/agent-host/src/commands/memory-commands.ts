/**
 * Host IPC handlers: memory.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'memory/list',
  'memory/read',
  'memory/search',
  'memory/write',
  'memory/update',
  'memory/delete',
  'memory/accept',
  'memory/quota',
]);

export function isMemoryCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handleMemoryCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'memory/list': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const records = await store.list(command.filter ?? {});
          return ok(requestId, 'memory/list', { records });
        }
        case 'memory/read': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const record = await store.read(command.memoryId);
          return ok(requestId, 'memory/read', { record });
        }
        case 'memory/search': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const hits = await store.search(command.query);
          return ok(requestId, 'memory/search', { hits });
        }
        case 'memory/write': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const record = await store.write(command.input);
          return ok(requestId, 'memory/write', { record });
        }
        case 'memory/update': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const record = await store.update(command.input);
          return ok(requestId, 'memory/update', { record });
        }
        case 'memory/delete': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const result = await store.delete(command.memoryId);
          return ok(requestId, 'memory/delete', result);
        }
        case 'memory/accept': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const record = await store.accept(command.memoryId);
          return ok(requestId, 'memory/accept', { record });
        }
        case 'memory/quota': {
          await context.requireMemoryEnabled();
          const store = context.getMemoryStore();
          const quotaOptions: { scope?: 'global' | 'project'; projectKey?: string } = {};
          if (command.scope) quotaOptions.scope = command.scope;
          if (command.projectKey) quotaOptions.projectKey = command.projectKey;
          const summaries = await store.quotaSummary(quotaOptions);
          return ok(requestId, 'memory/quota', { summaries });
        }

    default:
      return null;
  }
}
