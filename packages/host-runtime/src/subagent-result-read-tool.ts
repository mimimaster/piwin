/**
 * Reviewer-scoped read of one Host-bound frozen result.
 * Never accepts an arbitrary path or another result from the same session.
 */
import type {
  HostToolRegistration,
  SubagentResultRef,
  SubagentResultSummary,
  ToolResult,
} from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  isExactReviewTarget,
  isSameChangeVersionRef,
  type SubagentReviewCapabilityScope,
} from './subagent-review-context.js';
import { parseSubagentResultRef } from './subagent-tool-input.js';
import type { SubagentResultService } from './subagent-result-service.js';

export const SUBAGENT_RESULT_READ_TOOL_NAME = 'piwin_subagent_result_read';
export const SUBAGENT_RESULT_READ_PATCH_MAX_CHARS = 8000;

const MODES = new Set(['summary', 'files', 'diff']);

export type SubagentResultReadService = Pick<
  SubagentResultService,
  'get' | 'listFiles' | 'diffFile'
>;

export type SubagentResultReadToolOptions = {
  scope: SubagentReviewCapabilityScope;
  resultService: SubagentResultReadService;
};

export const subagentResultReadInputParameters = {
  type: 'object' as const,
  properties: {
    mode: {
      type: 'string',
      enum: ['summary', 'files', 'diff'],
      description: 'Read the bound result summary, a file page, or one file diff.',
    },
    result: {
      type: 'object',
      description: 'Must be the exact Host-bound review target.',
      properties: {
        resultId: { type: 'string' },
        revision: { type: 'number' },
      },
      required: ['resultId', 'revision'],
    },
    cursor: { type: 'string', description: 'File-list cursor from a previous page.' },
    limit: { type: 'number', description: 'File-list page size.' },
    fileId: { type: 'string', description: 'Frozen file id for mode=diff.' },
  },
  required: ['mode', 'result'] as const,
};

function reviewError(
  code: Extract<ToolResult, { ok: false }>['code'],
  message: string,
): Extract<ToolResult, { ok: false }> {
  return { ok: false, code, message };
}

function boundPatch(patch: string | undefined): { patch?: string; truncated: boolean } {
  if (patch === undefined) return { truncated: false };
  if (patch.length <= SUBAGENT_RESULT_READ_PATCH_MAX_CHARS) {
    return { patch, truncated: false };
  }
  return {
    patch: patch.slice(0, SUBAGENT_RESULT_READ_PATCH_MAX_CHARS),
    truncated: true,
  };
}

function authorizeRead(
  requested: SubagentResultRef,
  options: SubagentResultReadToolOptions,
): { ok: true; summary: SubagentResultSummary } | Extract<ToolResult, { ok: false }> {
  if (!isExactReviewTarget(requested, options.scope.result)) {
    return reviewError(
      'review-target-forbidden',
      'result is outside this reviewer scope',
    );
  }
  const summary = options.resultService.get(requested.resultId);
  if (!summary) {
    return reviewError('review-target-not-found', 'review target was not found');
  }
  if (summary.revision !== requested.revision) {
    return reviewError('stale-revision', 'review target revision is stale');
  }
  if (
    !summary.childChanges ||
    summary.copyState === 'removed' ||
    summary.copyState === 'missing'
  ) {
    return reviewError('review-data-expired', 'frozen review data is unavailable');
  }
  if (!isSameChangeVersionRef(summary.childChanges, options.scope.changes)) {
    return reviewError('review-data-expired', 'frozen review data is unavailable');
  }
  return { ok: true, summary };
}

export function createSubagentResultReadTool(
  options: SubagentResultReadToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: SUBAGENT_RESULT_READ_TOOL_NAME,
      description:
        'Read the Host-bound candidate summary, file list, or one file diff. ' +
        'Accepts only the exact review target. Binary files return metadata only.',
      parameters: subagentResultReadInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args) {
      const modeRaw = String(args.mode ?? '').trim();
      if (!MODES.has(modeRaw)) {
        return reviewError('invalid-input', 'mode must be summary, files, or diff');
      }
      const parsedResult = parseSubagentResultRef(args.result, 'result');
      if (!parsedResult.ok) return parsedResult;
      const authorized = authorizeRead(parsedResult.value, options);
      if (!authorized.ok) return authorized;

      if (modeRaw === 'summary') {
        const summary = authorized.summary;
        return {
          ok: true,
          output:
            `result ${summary.resultId} rev ${String(summary.revision)} ` +
            `${summary.executionStatus}/${summary.integrationStatus}`,
          details: {
            result: { resultId: summary.resultId, revision: summary.revision },
            childChanges: summary.childChanges,
            deliveryIntent: summary.deliveryIntent,
            reviewStatus: summary.reviewStatus,
            candidateLineageId: summary.candidateLineageId,
            candidateGeneration: summary.candidateGeneration,
          },
        };
      }

      if (modeRaw === 'files') {
        if (args.cursor !== undefined && typeof args.cursor !== 'string') {
          return reviewError('invalid-input', 'cursor must be a string');
        }
        if (
          args.limit !== undefined &&
          (typeof args.limit !== 'number' || !Number.isFinite(args.limit))
        ) {
          return reviewError('invalid-input', 'limit must be a number');
        }
        const page = options.resultService.listFiles({
          resultId: parsedResult.value.resultId,
          revision: authorized.summary.childChanges.revision,
          ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        });
        return {
          ok: true,
          output: `files ${String(page.files.length)}` +
            (page.nextCursor ? ` next=${page.nextCursor}` : ''),
          details: {
            files: page.files,
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
            truncated: page.nextCursor !== undefined,
          },
        };
      }

      const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
      if (!fileId) {
        return reviewError('invalid-input', 'fileId is required for mode=diff');
      }
      const diff = await options.resultService.diffFile({
        resultId: parsedResult.value.resultId,
        revision: authorized.summary.childChanges.revision,
        fileId,
      });
      if (!diff.ok) {
        return reviewError('review-target-not-found', 'file was not found on the frozen result');
      }
      if (diff.binary) {
        return {
          ok: true,
          output: 'binary file; metadata only',
          details: {
            additions: diff.additions,
            deletions: diff.deletions,
            binary: true,
            truncated: false,
          },
        };
      }
      const bounded = boundPatch(diff.patch);
      return {
        ok: true,
        output: bounded.truncated ? 'diff truncated' : 'diff',
        details: {
          additions: diff.additions,
          deletions: diff.deletions,
          binary: false,
          truncated: bounded.truncated,
          ...(bounded.patch === undefined ? {} : { patch: bounded.patch }),
        },
      };
    },
  };
}
