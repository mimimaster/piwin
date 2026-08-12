import {
  assertSessionBodyAvailable,
  formatError,
  type SessionIndexRecord,
  type SessionStorageInfo,
} from '@piwin/contracts';
import type { HostResponse } from '@piwin/contracts';
import { fail } from './response-helpers.js';

export function rejectUnavailableSessionBody(
  requestId: string | undefined,
  command: string,
  record: Pick<SessionIndexRecord, 'id'> & { storage?: SessionStorageInfo },
  operation: string,
): HostResponse | undefined {
  try {
    assertSessionBodyAvailable(record, operation);
    return undefined;
  } catch (error) {
    return fail(requestId, command, formatError(error));
  }
}
