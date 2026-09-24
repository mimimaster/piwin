import { describe, expect, it } from 'vitest';
import type { SubagentReviewRecord, ToolResult } from '@piwin/contracts';
import { createSubagentLeadReviewTool } from './subagent-lead-review-tool.js';
import type { SubagentLeadReviewSubmitInput } from './subagent-review-service.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

const TARGET = { resultId: 'result-1', revision: 1 };

function reviewRecord(input: SubagentLeadReviewSubmitInput): SubagentReviewRecord {
  return {
    reviewId: 'review-1',
    revision: 1,
    parentSessionId: input.parentSessionId,
    reviewerSessionId: input.parentSessionId,
    reviewerRunId: input.parentRunId,
    authority: 'lead',
    targetResult: input.target,
    targetChanges: { changeSetId: 'cs-1', revision: 1 },
    decision: input.decision,
    findings: input.findings,
    verification: input.verification,
    createdAt: '2026-09-24T00:00:00.000Z',
  };
}

function createTool(calls: SubagentLeadReviewSubmitInput[]) {
  const seam: SubagentRunSeam = {
    spawn: async () => {
      throw new Error('not used');
    },
    merge: async () => ({}),
    submitLeadReview: async (input) => {
      calls.push(input);
      return { ok: true, record: reviewRecord(input), duplicate: false };
    },
  };
  return createSubagentLeadReviewTool({ sessionId: 'parent-1', seam });
}

async function execute(
  tool: ReturnType<typeof createTool>,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'parent-1',
    runtimeGenerationId: 'generation-1',
    runId: 'lead-run',
    toolName: tool.descriptor.name,
    toolCallId: 'tool-call-1',
  });
}

describe('piwin_subagent_review_submit (Lead)', () => {
  it('binds the review to this parent run and prints the exact apply refs', async () => {
    const calls: SubagentLeadReviewSubmitInput[] = [];
    const tool = createTool(calls);
    expect(tool.descriptor.name).toBe('piwin_subagent_review_submit');

    const result = await execute(tool, {
      target: TARGET,
      decision: 'approved',
      findings: [],
      verification: [{ label: 'pnpm test', status: 'passed' }],
    });

    expect(calls).toEqual([
      {
        parentSessionId: 'parent-1',
        parentRunId: 'lead-run',
        target: TARGET,
        decision: 'approved',
        findings: [],
        verification: [{ label: 'pnpm test', status: 'passed' }],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    // Only the text reaches the model; apply needs both refs verbatim.
    expect(result.output).toContain(`result=${JSON.stringify(TARGET)}`);
    expect(result.output).toContain('approvedBy={"reviewId":"review-1","revision":1}');
  });

  it('rejects malformed input before reaching the Host', async () => {
    const calls: SubagentLeadReviewSubmitInput[] = [];
    const result = await execute(createTool(calls), {
      target: TARGET,
      decision: 'looks-good',
      findings: [],
      verification: [],
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(calls).toEqual([]);
  });
});
