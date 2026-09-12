/** Host IPC handlers for the durable subagent batch surface. */

import type {
  HostCommand,
  HostResponse,
  SubagentBatchProjection,
  SubagentBatchRequest,
  SubagentReviewRecord,
  SubagentReviewRef,
} from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import { applyReviewedSubagentResult } from '../subagent-result-apply.js';
import type { SubagentResultService } from '../subagent-result-service.js';

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
  ) => Promise<{
    integrationStatus: import('@piwin/contracts').SubagentIntegrationStatus;
    applyStatus?: 'succeeded' | 'rejected' | 'needs-repair';
  }>;
  resultService?: SubagentResultService;
  startParentPrompt?: (input: {
    parentSessionId: string;
    text: string;
    resultId: string;
  }) => Promise<{ runId: string }>;
  applyResult?: (input: {
    resultId: string;
    expectedRevision: number;
    operationId: string;
  }) => Promise<{
    operationId: string;
    status?: 'succeeded' | 'rejected' | 'needs-repair';
  }>;
  loadReview?: (ref: SubagentReviewRef) => Promise<SubagentReviewRecord | undefined>;
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

const RESULT_COMMAND_TYPES = new Set<HostCommand['type']>([
  'subagent/results',
  'subagent/result',
  'subagent/result-files',
  'subagent/result-diff',
  'subagent/cleanup-plan',
  'subagent/request-resolution',
]);

function unsupportedCapability(
  requestId: string | undefined,
  commandType: string,
): HostResponse {
  return fail(requestId, commandType, 'unsupported-capability', { code: 'unsupported-capability' });
}

function failCode(
  requestId: string | undefined,
  commandType: string,
  code: string,
  data?: unknown,
): HostResponse {
  if (data === undefined) {
    return fail(requestId, commandType, code, { code });
  }
  return fail(requestId, commandType, code, { code, data });
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

  if (command.type === 'subagent/worktree-action') {
    const resultId = command.resultId;
    if (typeof resultId === 'string' && resultId.length > 0) {
      if (
        (command.action === 'apply' || command.action === 'discard') &&
        typeof command.expectedRevision !== 'number'
      ) {
        return failCode(requestId, command.type, 'upgrade-required');
      }
      if (!context?.resultService) {
        return unsupportedCapability(requestId, command.type);
      }
      return handleResultWorktreeAction(command, requestId, context);
    }
  } else if (RESULT_COMMAND_TYPES.has(command.type)) {
    if (!context?.resultService) {
      return unsupportedCapability(requestId, command.type);
    }
    return handleResultCommand(command, requestId, context);
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
      if (command.action === 'apply' || command.action === 'discard') {
        return failCode(requestId, command.type, 'upgrade-required');
      }
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

async function handleResultCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SubagentCommandContext,
): Promise<HostResponse> {
  const resultService = context.resultService;
  if (!resultService) {
    return unsupportedCapability(requestId, command.type);
  }

  switch (command.type) {
    case 'subagent/results': {
      const page = resultService.list({
        parentSessionId: command.parentSessionId,
        ...(command.attemptId === undefined ? {} : { attemptId: command.attemptId }),
        ...(command.pendingOnly === undefined ? {} : { pendingOnly: command.pendingOnly }),
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      });
      return ok(requestId, command.type, page);
    }
    case 'subagent/result': {
      const summary = resultService.get(command.resultId);
      if (!summary) return failCode(requestId, command.type, 'not-found');
      return ok(requestId, command.type, summary);
    }
    case 'subagent/result-files': {
      if (!resultService.get(command.resultId)) {
        return failCode(requestId, command.type, 'not-found');
      }
      const page = resultService.listFiles({
        resultId: command.resultId,
        revision: command.revision,
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      });
      return ok(requestId, command.type, page);
    }
    case 'subagent/result-diff': {
      const diff = await resultService.diffFile({
        resultId: command.resultId,
        revision: command.revision,
        fileId: command.fileId,
      });
      if (!diff.ok) return failCode(requestId, command.type, diff.code);
      return ok(requestId, command.type, {
        additions: diff.additions,
        deletions: diff.deletions,
        binary: diff.binary,
        ...(diff.patch === undefined ? {} : { patch: diff.patch }),
      });
    }
    case 'subagent/cleanup-plan': {
      const plan = resultService.planCleanup(command.resultId, command.expectedRevision);
      if (!plan.ok) return failCode(requestId, command.type, plan.code);
      return ok(requestId, command.type, {
        worktreePath: plan.worktreePath,
        token: plan.token,
        expiresAt: plan.expiresAt,
      });
    }
    case 'subagent/request-resolution': {
      const startParentPrompt = context.startParentPrompt;
      if (!startParentPrompt) {
        return unsupportedCapability(requestId, command.type);
      }
      const outcome = await resultService.requestResolution({
        resultId: command.resultId,
        expectedRevision: command.expectedRevision,
        purpose: command.purpose,
        startParentPrompt,
      });
      if (!outcome.ok) return failCode(requestId, command.type, outcome.code);
      return ok(requestId, command.type, { runId: outcome.runId });
    }
    default:
      return unsupportedCapability(requestId, command.type);
  }
}

async function handleResultWorktreeAction(
  command: Extract<HostCommand, { type: 'subagent/worktree-action' }>,
  requestId: string | undefined,
  context: SubagentCommandContext,
): Promise<HostResponse> {
  const resultService = context.resultService;
  const resultId = command.resultId;
  if (!resultService || typeof resultId !== 'string' || resultId.length === 0) {
    return unsupportedCapability(requestId, command.type);
  }

  if (command.action === 'apply') {
    const expectedRevision = command.expectedRevision;
    const applyResult = context.applyResult;
    if (typeof expectedRevision !== 'number') {
      return failCode(requestId, command.type, 'upgrade-required');
    }
    if (!applyResult || !context.loadReview) {
      return unsupportedCapability(requestId, command.type);
    }
    const summary = resultService.get(resultId);
    if (!summary) {
      return failCode(requestId, command.type, 'not-found');
    }
    const approvedBy = summary.latestReview;
    if (!approvedBy) {
      return failCode(requestId, command.type, 'review-missing');
    }
    const outcome = await applyReviewedSubagentResult(
      {
        resultService,
        loadReview: context.loadReview,
        applyResult,
      },
      {
        parentSessionId: summary.parentSessionId,
        result: { resultId, revision: expectedRevision },
        approvedBy,
      },
    );
    if (!outcome.ok) {
      return failCode(
        requestId,
        command.type,
        outcome.code,
        outcome.code === 'already-applied' ? { alreadyApplied: true } : undefined,
      );
    }
    return ok(requestId, command.type, {
      resultId,
      action: command.action,
      operationId: outcome.operationId,
    });
  }

  if (command.action === 'retain') {
    const summary = resultService.get(resultId);
    if (!summary) return failCode(requestId, command.type, 'not-found');
    if (
      typeof command.expectedRevision === 'number' &&
      command.expectedRevision !== summary.revision
    ) {
      return failCode(requestId, command.type, 'stale-revision');
    }
    return ok(requestId, command.type, {
      resultId,
      action: command.action,
      integrationStatus: 'retained',
    });
  }

  const expectedRevision = command.expectedRevision;
  if (typeof expectedRevision !== 'number') {
    return failCode(requestId, command.type, 'upgrade-required');
  }
  const summary = resultService.get(resultId);
  if (!summary) return failCode(requestId, command.type, 'not-found');
  if (summary.revision !== expectedRevision) {
    return failCode(requestId, command.type, 'stale-revision');
  }
  return ok(requestId, command.type, {
    resultId,
    action: command.action,
    operationId: `discard:${resultId}:${String(expectedRevision)}`,
  });
}
