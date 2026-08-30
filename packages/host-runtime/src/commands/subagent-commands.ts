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
  continueChild: (childSessionId: string, text: string) => Promise<{ runId: string }>;
  actOnWorktree: (
    childSessionId: string,
    action: 'apply' | 'retain' | 'discard',
  ) => Promise<{ integrationStatus: import('@piwin/contracts').SubagentIntegrationStatus }>;
};

const TYPES = new Set<HostCommand['type']>([
  'subagent/batch-start',
  'subagent/batch-status',
  'subagent/batch-cancel',
  'subagent/continue',
  'subagent/worktree-action',
  'subagent/results',
  'subagent/result',
  'subagent/result-files',
  'subagent/result-diff',
  'subagent/cleanup-plan',
  'subagent/request-resolution',
]);

const UNIMPLEMENTED_RESULT_TYPES = new Set<HostCommand['type']>([
  'subagent/results',
  'subagent/result',
  'subagent/result-files',
  'subagent/result-diff',
  'subagent/cleanup-plan',
  'subagent/request-resolution',
]);

/** W5 implements result storage / apply / cleanup. */
function unsupportedCapability(
  requestId: string | undefined,
  commandType: string,
): HostResponse {
  return fail(requestId, commandType, 'unsupported-capability', { code: 'unsupported-capability' });
}

export function isSubagentCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleSubagentCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SubagentCommandContext | undefined,
): Promise<HostResponse | null> {
  if (!isSubagentCommand(command)) return null;
  if (UNIMPLEMENTED_RESULT_TYPES.has(command.type)) {
    return unsupportedCapability(requestId, command.type);
  }
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
    case 'subagent/continue': {
      const text = command.text.trim();
      if (!text) return fail(requestId, command.type, 'follow-up text is required');
      const accepted = await context.continueChild(command.childSessionId, text);
      return ok(requestId, command.type, {
        ...accepted,
        childSessionId: command.childSessionId,
        acceptedAt: new Date().toISOString(),
      });
    }
    case 'subagent/worktree-action': {
      const childSessionId = command.childSessionId;
      if (typeof childSessionId !== 'string' || childSessionId.length === 0) {
        return unsupportedCapability(requestId, command.type);
      }
      const result = await context.actOnWorktree(childSessionId, command.action);
      return ok(requestId, command.type, {
        childSessionId,
        action: command.action,
        ...result,
      });
    }
    default:
      return null;
  }
}
