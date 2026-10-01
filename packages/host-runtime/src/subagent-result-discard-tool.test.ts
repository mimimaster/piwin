import { describe, expect, it, vi } from 'vitest';
import type { HostToolExecutionContext, ToolResult } from '@piwin/contracts';

import { subagentStartInputParameters } from './subagent-tool-input.js';
import {
  SUBAGENT_RESULT_DISCARD_TOOL_NAME,
  createSubagentResultDiscardTool,
} from './subagent-result-discard-tool.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

const SESSION_ID = 'parent-1';
const CONTEXT = { runId: 'run-9', toolCallId: 'call-1' } as unknown as HostToolExecutionContext;
const REF = { resultId: 'result-1', revision: 2 };

function seamWith(discardResult: SubagentRunSeam['discardResult']): SubagentRunSeam {
  return {
    spawn: async () => {
      throw new Error('unused');
    },
    merge: async () => ({}),
    ...(discardResult ? { discardResult } : {}),
  };
}

async function run(seam: SubagentRunSeam, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  const tool = createSubagentResultDiscardTool({ sessionId: SESSION_ID, seam });
  return tool.execute(args, signal ?? new AbortController().signal, CONTEXT) as Promise<ToolResult>;
}

describe('piwin_subagent_result_discard', () => {
  it('describes itself as a delegate tool that goes through the permission engine', () => {
    const tool = createSubagentResultDiscardTool({ sessionId: SESSION_ID, seam: seamWith(undefined) });

    expect(tool.descriptor.name).toBe(SUBAGENT_RESULT_DISCARD_TOOL_NAME);
    expect(tool.family).toBe('delegate');
    expect(tool.permissionSpec.admission).toBeUndefined();
    expect(tool.permissionSpec.subjectBuilder?.({}, CONTEXT)).toEqual({ kind: 'tool', action: 'subagent:run' });
    expect(tool.descriptor.parameters).toMatchObject({ required: ['result'] });
    // A discard names a result, never a branch or path.
    expect(Object.keys((tool.descriptor.parameters as { properties: object }).properties)).toEqual(['result']);
    expect(Object.keys(subagentStartInputParameters.properties)).not.toContain('result');
  });

  it('discards the exact result for this session and reports the outcome', async () => {
    const discardResult = vi.fn(async () => ({
      ok: true as const,
      result: REF,
      integrationStatus: 'discarded' as const,
      alreadySettled: false,
    }));

    const outcome = await run(seamWith(discardResult), { result: REF });

    expect(discardResult).toHaveBeenCalledWith({ parentSessionId: SESSION_ID, parentRunId: 'run-9', result: REF });
    expect(outcome).toMatchObject({
      ok: true,
      details: { result: REF, integrationStatus: 'discarded', alreadySettled: false },
    });
    expect(outcome.ok && outcome.output).toContain('discarded');
  });

  it('says so when there was nothing to discard', async () => {
    const outcome = await run(
      seamWith(async () => ({ ok: true, result: REF, integrationStatus: 'discarded', alreadySettled: true })),
      { result: REF },
    );

    expect(outcome.ok && outcome.output).toContain('nothing pending');
  });

  it('passes a refusal through with the run id attached', async () => {
    const outcome = await run(
      seamWith(async () => ({ ok: false, code: 'already-applied', message: 'result was already applied' })),
      { result: REF },
    );

    expect(outcome).toMatchObject({ ok: false, code: 'already-applied', details: { runId: 'run-9' } });
  });

  it('rejects a malformed request before reaching the Host', async () => {
    const discardResult = vi.fn();

    expect(await run(seamWith(discardResult), {})).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(await run(seamWith(discardResult), { result: { resultId: 'r' } })).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
    expect(await run(seamWith(discardResult), { result: REF, workspacePath: '/x' })).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
    expect(discardResult).not.toHaveBeenCalled();
  });

  it('reports unavailable and aborted without calling the Host', async () => {
    expect(await run(seamWith(undefined), { result: REF })).toMatchObject({
      ok: false,
      code: 'tool-not-available',
    });
    const controller = new AbortController();
    controller.abort();
    const discardResult = vi.fn();
    expect(await run(seamWith(discardResult), { result: REF }, controller.signal)).toMatchObject({
      ok: false,
      code: 'aborted',
      cancelled: true,
    });
    expect(discardResult).not.toHaveBeenCalled();
  });

  it('maps an unexpected Host failure to a tool error', async () => {
    const outcome = await run(
      seamWith(async () => {
        throw new Error('disk gone');
      }),
      { result: REF },
    );

    expect(outcome).toMatchObject({ ok: false, code: 'subagent-failed', message: expect.stringContaining('disk gone') });
  });
});
