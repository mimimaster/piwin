/**
 * Host IPC handlers: automation.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  deleteCronJob,
  getCronStorePath,
  getHooksStorePath,
  loadCronJobs,
  loadHooks,
  setHooks,
  upsertCronJob,
} from '@piwin/automation';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot } from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'cron/list',
  'cron/upsert',
  'cron/delete',
  'cron/run',
  'hooks/list',
  'hooks/set',
  'todo/get',
  'todo/set',
]);

export function isAutomationCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handleAutomationCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'cron/list': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const doc = await loadCronJobs(getCronStorePath(rootDir));
          return ok(requestId, 'cron/list', doc);
        }
        case 'cron/upsert': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const job = await upsertCronJob(getCronStorePath(rootDir), command.job);
          return ok(requestId, 'cron/upsert', { job });
        }
        case 'cron/delete': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const deleted = await deleteCronJob(getCronStorePath(rootDir), command.jobId);
          return ok(requestId, 'cron/delete', { deleted });
        }
        case 'cron/run': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const path = getCronStorePath(rootDir);
          const doc = await loadCronJobs(path);
          const job = doc.jobs.find((item) => item.id === command.jobId);
          if (!job) {
            return fail(requestId, 'cron/run', `Unknown cron job: ${command.jobId}`);
          }
          const result = await context.runCronJob(job);
          return ok(requestId, 'cron/run', result);
        }
        case 'hooks/list': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const doc = await loadHooks(getHooksStorePath(rootDir));
          return ok(requestId, 'hooks/list', doc);
        }
        case 'hooks/set': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const doc = await setHooks(getHooksStorePath(rootDir), command.hooks);
          return ok(requestId, 'hooks/set', doc);
        }
        case 'todo/get': {
          const list = context.todoStore.get(command.sessionId);
          return ok(requestId, 'todo/get', list);
        }
        case 'todo/set': {
          const current = context.todoStore.get(command.sessionId);
          if (
            command.expectedRevision !== undefined &&
            command.expectedRevision !== current.revision
          ) {
            return fail(requestId, 'todo/set', 'todo-revision-conflict', {
              code: 'todo-revision-conflict',
              data: { sessionId: command.sessionId, actualRevision: current.revision },
            });
          }
          const list = context.todoStore.set(command.sessionId, command.items);
          context.push({ type: 'todo/updated', sessionId: command.sessionId, items: list.items });
          return ok(requestId, 'todo/set', list);
        }

    default:
      return null;
  }
}
