/** Host IPC handlers for the durable subagent batch surface. */

import type {
  HostCommand,
  HostResponse,
  SubagentBatchProjection,
  SubagentBatchRequest,
} from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';

export const NOT_READY_SUBAGENT_ORCHESTRATION_MESSAGE =
  'subagent orchestration is not ready in this host runtime';

export type SubagentCommandContext = {
  prepareBatch: (request: SubagentBatchRequest) => Promise<SubagentBatchRequest>;
  startBatch: (request: SubagentBatchRequest, parentRunId?: string) => { runId: string };
  getBatchProjection: (runId: string) => Promise<SubagentBatchProjection>;
  cancelBatch: (runId: string) => Promise<void>;
};

const TYPES = new Set<HostCommand['type']>([
  'subagent/batch-start',
  'subagent/batch-status',
  'subagent/batch-cancel',
]);

export function isSubagentCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleSubagentCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SubagentCommandContext | undefined,
): Promise<HostResponse | null> {
  if (!isSubagentCommand(command)) return null;
  if (!context) {
    return fail(requestId, command.type, NOT_READY_SUBAGENT_ORCHESTRATION_MESSAGE);
  }

  switch (command.type) {
    case 'subagent/batch-start': {
      const preparedRequest = await context.prepareBatch(command.request);
      const handle = context.startBatch(preparedRequest, command.parentRunId);
      return ok(requestId, command.type, {
        runId: handle.runId,
        acceptedAt: new Date().toISOString(),
      });
    }
    case 'subagent/batch-status': {
      const projection = await context.getBatchProjection(command.runId);
      return ok(requestId, command.type, projection);
    }
    case 'subagent/batch-cancel': {
      await context.cancelBatch(command.runId);
      return ok(requestId, command.type, { cancelled: true });
    }
    default:
      return null;
  }
}
