import { describe, expect, it } from 'vitest';
import {
  AUTO_SCHEME_ID,
  FUSION_SCHEME_ID,
  resolveOrchestrationScheme,
  type HostToolExecutionContext,
  type ResolvedOrchestrationScheme,
} from '@piwin/contracts';
import { createSchemePlaybookTool, formatSchemePlaybook } from './scheme-playbook-tool.js';
import { formatAutoWaitNextSteps } from './auto-scheme-next-steps.js';

const KNOWN = { knownProfileIds: ['explorer', 'implementer', 'reviewer', 'tester'] };

function scheme(id: string): ResolvedOrchestrationScheme {
  const resolved = resolveOrchestrationScheme({ maxConcurrency: 4, maxTasksPerRun: 8 }, id, KNOWN);
  if (!resolved) throw new Error(`scheme ${id} did not resolve`);
  return resolved;
}

function context(runId: string): HostToolExecutionContext {
  return { sessionId: 'parent', runId, runtimeGenerationId: 'gen-1' } as HostToolExecutionContext;
}

describe('piwin_scheme_playbook', () => {
  it('serves Auto role playbooks and explains other cases', () => {
    expect(formatSchemePlaybook(scheme(AUTO_SCHEME_ID), 'sidekick')).toContain('<playbook role="sidekick">');
    expect(formatSchemePlaybook(scheme(FUSION_SCHEME_ID), 'sidekick')).toMatch(/no separate playbooks/);
    expect(formatSchemePlaybook(undefined, 'scout')).toMatch(/No orchestration scheme/);
  });

  it('loads a role once per run and again in the next run', async () => {
    const tool = createSchemePlaybookTool({ getActiveScheme: () => scheme(AUTO_SCHEME_ID) });
    const signal = new AbortController().signal;
    const first = await tool.execute({ role: 'tester' }, signal, context('run-1'));
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error('expected playbook');
    expect(first.output).toContain('<playbook role="tester">');
    const again = await tool.execute({ role: 'tester' }, signal, context('run-1'));
    expect(again.ok && again.output).toMatch(/already loaded/);
    const nextRun = await tool.execute({ role: 'tester' }, signal, context('run-2'));
    expect(nextRun.ok && nextRun.output).toContain('<playbook role="tester">');
    expect(await tool.execute({}, signal, context('run-3'))).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
  });
});

describe('Auto wait next steps', () => {
  const result = { resultId: 'res-1', revision: 2 };
  const base = {
    runId: 'run-a',
    batchStatus: 'completed' as const,
    executionStatus: 'completed' as const,
    integrationStatus: 'retained' as const,
    resultRef: result,
  };

  it('points an unreviewed candidate at Lead review or a reviewer', () => {
    const text = formatAutoWaitNextSteps([base]);
    expect(text).toContain('piwin_subagent_review_submit');
    expect(text).toContain('reviewOf={"resultId":"res-1","revision":2}');
  });

  it('points an approved candidate at apply and the tester', () => {
    const text = formatAutoWaitNextSteps([
      { ...base, reviewDecision: 'approved', reviewRef: { reviewId: 'rev-1', revision: 1 } },
    ]);
    expect(text).toContain('piwin_subagent_result_apply result={"resultId":"res-1","revision":2}');
    expect(text).toContain('approvedBy={"reviewId":"rev-1","revision":1}');
    expect(text).toContain('role="tester"');
  });

  it('stays silent for scouts and failed runs', () => {
    const { resultRef: _omit, ...scout } = base;
    void _omit;
    expect(formatAutoWaitNextSteps([scout])).toBeUndefined();
    expect(formatAutoWaitNextSteps([{ ...base, executionStatus: 'failed' }])).toBeUndefined();
  });
});
