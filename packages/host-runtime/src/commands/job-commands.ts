
/**
 * Host IPC handlers: job/* — direct JobController surface.
 *
 * Replaces the legacy process/* compatibility adapter. Desktop and CLI
 * consume job/* commands and JobHostPush variants directly.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'job/start',
  'job/list',
  'job/get',
  'job/logs',
  'job/wait',
  'job/stop',
]);

export function isJobCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleJobCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  const jobController = context.getJobController();

  switch (command.type) {
    case 'job/start': {
      const job = await jobController.start(command.input);
      return ok(requestId, 'job/start', { job });
    }
    case 'job/list': {
      const jobs = await jobController.list(command.filter);
      return ok(requestId, 'job/list', { jobs });
    }
    case 'job/get': {
      const job = await jobController.get(command.jobId);
      if (!job) {
        return fail(requestId, 'job/get', `Unknown job: ${command.jobId}`);
      }
      return ok(requestId, 'job/get', { job });
    }
    case 'job/logs': {
      const result = await jobController.readLogs(command.input);
      return ok(requestId, 'job/logs', result);
    }
    case 'job/wait': {
      const controller = new AbortController();
      const job = await jobController.wait(command.input, controller.signal);
      return ok(requestId, 'job/wait', { job });
    }
    case 'job/stop': {
      const stopResult = await jobController.stop(
        command.jobId,
        command.reason ?? 'user-stop',
      );
      return ok(requestId, 'job/stop', stopResult);
    }
    default:
      return null;
  }
}
