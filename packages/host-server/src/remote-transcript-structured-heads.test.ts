import { describe, expect, it } from 'vitest';
import type { ToolPresentation } from '@piwin/contracts';
import { projectRemoteTranscriptTools } from './remote-transcript-tool-projection.js';
import { createRemoteCapabilities, projectRemoteResponse } from './remote-projection.js';

const result = { resultId: 'result-1', revision: 2 };
const reviewRef = { reviewId: 'review-1', revision: 3 };
const verificationRef = { verificationId: 'verification-1', revision: 4 };
const heads: Partial<ToolPresentation>[] = [
  { goal: { phase: 'completed', summary: 'Done', verification: 'tests passed', artifacts: ['/Users/public/project/app.ts'] } },
  { goal: { phase: 'blocked', reason: 'Needs decision', unblockAction: 'Choose scope' } },
  { goal: { phase: 'waited', reason: 'CI queue', durationSeconds: 10 } },
  { goal: { phase: 'waited', reason: 'External job' } },
  { goal: { phase: 'completed', summary: 'Summary only' } },
  { subagentLoop: { kind: 'result-read', result, mode: 'diff', summary: 'Candidate summary' } },
  { subagentLoop: { kind: 'review-submit', target: result, reviewRef, decision: 'changes-requested' } },
  { subagentLoop: { kind: 'result-apply', result, operationId: 'op-1', integrationStatus: 'applied' } },
  { subagentLoop: { kind: 'result-discard', result, integrationStatus: 'retained', alreadySettled: true } },
  { subagentLoop: { kind: 'verification-submit', result, verificationRef, status: 'failed' } },
  { subagentLoop: { kind: 'verification-submit', result, verificationRef, status: 'passed' } },
  { subagentControl: { phase: 'accepted', runId: 'run-1', invocationId: 'inv-1', task: 'Bounded task', childSessionId: 'child-1', predecessorResult: result, reviewRef } },
  ...(['waiting', 'waited'] as const).map((phase): Partial<ToolPresentation> => ({ subagentControl: {
    phase, total: 2, completed: 0, failed: 1, cancelled: 1, needsIntegration: 1, runs: [
      { runId: 'run-1', executionStatus: 'failed', summaryStatus: 'failed', integrationStatus: 'retained', activity: 'Test run', summaryPreview: 'Failure retained', childSessionId: 'child-1' },
      { runId: 'run-2', executionStatus: 'cancelled', summaryStatus: 'not-requested', integrationStatus: 'not-requested' },
    ],
  } })),
  ...(['cancelling', 'cancelled'] as const).map((phase): Partial<ToolPresentation> => ({ subagentControl: {
    phase, total: 1, cancelled: 1, alreadyTerminal: 0, runs: [{ runId: 'run-2', executionStatus: 'cancelled' }],
  } })),
];
function project(head: unknown): ToolPresentation | undefined {
  return projectRemoteTranscriptTools([{ toolCallId: 't1', toolName: 'public-tool', status: 'done', presentation: { kind: 'other', title: 'Public tool', ...head as Record<string, unknown> } }])[0]?.presentation;
}

describe('public structured history heads', () => {
  it.each(heads)('preserves only known public content: %j', (head) => {
    expect(project(head)).toEqual({ kind: 'other', title: 'Public tool', ...head });
  });

  it.each(['session/messages', 'session/resume'] as const)('preserves heads through %s hydration', (type) => {
    const tools = heads.map((head, index) => ({ toolCallId: `t${index}`, toolName: 'public-tool', status: 'done', presentation: { kind: 'other', title: 'Public tool', ...head } }));
    const projected = projectRemoteResponse({ type, sessionId: 's1' }, { type: 'response', command: type, success: true,
      data: { sessionId: 's1', messages: [{ id: 'm1', role: 'assistant', text: '', createdAt: '2026-10-02', status: 'done', tools }] },
    }, { hostInstanceId: 'host-1', mode: 'sdk', capabilities: createRemoteCapabilities() });
    expect(projected.success).toBe(true);
    if (!projected.success) throw new Error(projected.error);
    expect(projected.data).toMatchObject({ messages: [{ tools: tools.map((tool) => ({ presentation: tool.presentation })) }] });
  });

  it('drops unknown secret/scope/lease/output keys at every public nested boundary', () => {
    const secret = { apiKey: 'SECRET_SENTINEL', reviewScope: { root: '/internal/worktree' }, executorLease: { token: 'LEASE_SENTINEL' }, output: 'RAW_OUTPUT', prompt: 'RAW_PROMPT' };
    for (const head of heads) {
      const poisoned = Object.fromEntries(Object.entries(head).map(([key, value]) => {
        const source = value as Record<string, unknown>;
        const nested = Object.fromEntries(Object.entries(source).map(([name, item]) => [name,
          Array.isArray(item) && name === 'runs' ? item.map((run: unknown) => ({ ...run as Record<string, unknown>, ...secret }))
            : item !== null && typeof item === 'object' && !Array.isArray(item) ? { ...item as Record<string, unknown>, ...secret } : item,
        ]));
        return [key, { ...nested, ...secret }];
      }));
      const projected = project({ ...poisoned, ...secret });
      expect(projected).toEqual(project(head));
      expect(JSON.stringify(projected)).not.toMatch(/SECRET_SENTINEL|LEASE_SENTINEL|RAW_OUTPUT|RAW_PROMPT|internal\/worktree/);
    }
  });

  it('bounds text/arrays without clipping opaque identity or changing path policy', () => {
    const long = 'z'.repeat(10_000);
    const goal = project({ goal: { phase: 'completed', summary: long, verification: long, artifacts: Array.from({ length: 100 }, () => long) } })?.goal;
    expect(goal?.phase).toBe('completed');
    if (goal?.phase !== 'completed') throw new Error('Missing bounded goal');
    expect(goal.summary.length).toBeLessThanOrEqual(2_048);
    expect(goal.verification?.length).toBeLessThanOrEqual(2_048);
    expect(goal.artifacts).toHaveLength(24);
    expect(goal.artifacts?.every((label) => label.length <= 2_048)).toBe(true);
    const control = project({ subagentControl: { phase: 'waited', total: 100, completed: 0, failed: 0, cancelled: 0, needsIntegration: 0,
      runs: Array.from({ length: 100 }, (_, i) => ({ runId: `run-${i}`, executionStatus: 'completed', title: long, activity: long, summaryPreview: long })) } })?.subagentControl;
    if (control === undefined || control.phase === 'accepted') throw new Error('Missing bounded control');
    expect(control.runs).toHaveLength(8);
    expect(control.runs[0]?.title?.length).toBeLessThanOrEqual(96);
    expect(control.runs[0]?.activity?.length).toBeLessThanOrEqual(120);
    expect(control.runs[0]?.summaryPreview?.length).toBeLessThanOrEqual(240);
    expect(project({ goal: { phase: 'blocked', reason: '/Users/public/project/app.ts', unblockAction: 'Read /Users/public/project/app.ts' } })?.goal).toEqual({ phase: 'blocked', reason: '/Users/public/project/app.ts', unblockAction: 'Read /Users/public/project/app.ts' });
  });

  it.each([
    { goal: { phase: 'unknown', reason: 'x' } },
    { goal: [] }, { goal: '{"phase":"completed","summary":"x"}' },
    { goal: { phase: 'completed', summary: 'ok', verification: {} } },
    { goal: { phase: 'completed', summary: 'ok', artifacts: [{}] } },
    ...[NaN, Infinity, -1, 1_000_001].map((durationSeconds) => ({ goal: { phase: 'waited', reason: 'x', durationSeconds } })),
    { subagentControl: { phase: 'accepted', runId: 'x'.repeat(257), invocationId: 'i1', task: 'x' } },
    { subagentControl: { phase: 'accepted', runId: 'r1', invocationId: 'i1', task: 'x', predecessorResult: { resultId: 'r1', revision: -1 } } },
    ...[NaN, Infinity, -1, 0.5, 1_000_001].map((total) => ({ subagentControl: { phase: 'waited', total, completed: 0, failed: 0, cancelled: 0, needsIntegration: 0, runs: [] } })),
    { subagentControl: { phase: 'waited', total: 1, completed: 0, failed: 0, cancelled: 0, needsIntegration: 0, runs: [{ runId: 'r1', executionStatus: 'unknown' }] } },
    { subagentLoop: { kind: 'other', result } },
    { subagentLoop: { kind: 'result-read', result, mode: 'summary' } },
    { subagentLoop: { kind: 'result-read', result: { resultId: 'r1', revision: Number.MAX_SAFE_INTEGER + 1 }, mode: 'summary', summary: 'x' } },
    { subagentLoop: { kind: 'result-apply', result, operationId: 'x'.repeat(257), integrationStatus: 'applied' } },
    { subagentLoop: { kind: 'result-discard', result, integrationStatus: 'discarded' } },
    { subagentLoop: { kind: 'verification-submit', result, verificationRef, status: 'delivered' } },
  ])('keeps generic fallback for malformed/oversized head: %j', (head) => {
    expect(project(head)).toEqual({ kind: 'other', title: 'Public tool' });
  });
});
