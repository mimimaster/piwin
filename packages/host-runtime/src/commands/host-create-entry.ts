import type { HostCommand, HostResponse } from '@piwin/contracts';
import { createHostEntry, HostEntryCreateError } from '@piwin/project';
import { fail, ok } from '../response-helpers.js';

export async function handleHostCreateEntry(
  command: Extract<HostCommand, { type: 'host/create-entry' }>,
  requestId: string | undefined,
): Promise<HostResponse> {
  try {
    return ok(requestId, command.type, await createHostEntry(command.input));
  } catch (error) {
    if (!(error instanceof HostEntryCreateError)) throw error;
    return fail(requestId, command.type, error.message, { code: error.code });
  }
}
