/**
 * Host IPC handlers: stored health summaries and the scheduled digest.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

export async function handleHealthCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (
    command.type !== 'health/status' &&
    command.type !== 'health/delete-summaries' &&
    command.type !== 'health/run-digest'
  ) {
    return null;
  }
  const service = context.healthSummaries;
  if (service === undefined) {
    return fail(requestId, command.type, 'health summaries are not available on this Host');
  }
  try {
    switch (command.type) {
      case 'health/status':
        return ok(requestId, 'health/status', await service.status());
      case 'health/delete-summaries': {
        if (command.deviceId === undefined) {
          await service.deleteAll();
        } else {
          await service.deleteDevice(command.deviceId);
        }
        return ok(requestId, 'health/delete-summaries', await service.status());
      }
      case 'health/run-digest': {
        const outcome = await service.runDigest('manual');
        return outcome.ok
          ? ok(requestId, 'health/run-digest', outcome)
          : fail(requestId, 'health/run-digest', outcome.message ?? 'digest failed');
      }
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}
