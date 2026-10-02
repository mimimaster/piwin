// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPresentation } from '@piwin/contracts';
import { ToolRow } from './ToolRow.js';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});
const result = { resultId: 'result-1', revision: 2 };
const fixtures: { presentation: ToolPresentation; expected: string[] }[] = [
  { presentation: { kind: 'other', title: 'goal', goal: { phase: 'completed', summary: 'Done', verification: 'tests passed', artifacts: ['/Users/public/project/app.ts'] } }, expected: ['目标完成', 'Done', '验证证据', 'tests passed', '产物', '/Users/public/project/app.ts'] },
  { presentation: { kind: 'other', title: 'goal', goal: { phase: 'blocked', reason: 'Needs decision', unblockAction: 'Choose scope' } }, expected: ['目标受阻', 'Needs decision', '解除阻碍', 'Choose scope'] },
  { presentation: { kind: 'other', title: 'goal', goal: { phase: 'waited', reason: 'CI queue', durationSeconds: 10 } }, expected: ['等待结束', 'CI queue', '等待时长', '10 秒'] },
  { presentation: { kind: 'other', title: 'read', subagentLoop: { kind: 'result-read', result, mode: 'files', summary: 'Candidate summary' } }, expected: ['读取结果', 'Candidate summary', '读取模式', 'files'] },
  { presentation: { kind: 'other', title: 'review', subagentLoop: { kind: 'review-submit', target: result, reviewRef: { reviewId: 'review-1', revision: 3 }, decision: 'blocked' } }, expected: ['提交审查', 'blocked', 'review-1 · r3'] },
  { presentation: { kind: 'other', title: 'apply', subagentLoop: { kind: 'result-apply', result, operationId: 'op-1', integrationStatus: 'applied' } }, expected: ['应用结果', 'applied', 'op-1'] },
  { presentation: { kind: 'other', title: 'discard', subagentLoop: { kind: 'result-discard', result, integrationStatus: 'retained', alreadySettled: true } }, expected: ['丢弃结果', 'retained', '此次未更改'] },
  { presentation: { kind: 'other', title: 'verify', subagentLoop: { kind: 'verification-submit', result, verificationRef: { verificationId: 'verification-1', revision: 4 }, status: 'failed' } }, expected: ['提交验证', 'failed', 'verification-1 · r4', '验证失败（不代表已交付）'] },
];

async function render(presentation: ToolPresentation): Promise<{ readOutput: ReturnType<typeof vi.fn>; openSession: ReturnType<typeof vi.fn> }> {
  const readOutput = vi.fn(async () => ({ status: 'ready' as const, output: 'bounded Host output', truncated: false, redacted: false, provenance: 'tool-snapshot' as const }));
  const openSession = vi.fn();
  act(() => root.render(<ToolRow tool={{ id: 't1', name: presentation.title, status: 'done', presentation }} messageId="m1" readOutput={readOutput} onOpenSession={openSession} />));
  expect(readOutput).not.toHaveBeenCalled();
  const toggle = container.querySelector<HTMLButtonElement>('.tr');
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { toggle?.click(); });
  expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  return { readOutput, openSession };
}

describe('readonly structured ToolRow', () => {
  it.each(fixtures)('renders public $presentation.title facts without mutation controls', async ({ presentation, expected }) => {
    const { readOutput, openSession } = await render(presentation);
    for (const text of expected) expect(container.textContent).toContain(text);
    if (presentation.subagentLoop !== undefined) expect(container.textContent).toContain('result-1 · r2');
    expect(container.textContent).toContain('Host');
    expect(container.querySelectorAll('button')).toHaveLength(1); // Expand only, no approve/apply/discard/verify action.
    expect(readOutput).toHaveBeenCalledExactlyOnceWith('m1', 't1');
    expect(openSession).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('delivered');
    if (presentation.subagentLoop?.kind === 'verification-submit') expect(container.querySelector('.tr-err')?.textContent).toContain('验证失败');
  });

  it.each(['waiting', 'waited', 'cancelling', 'cancelled'] as const)('shows %s aggregate/lifecycle/summary and existing child navigation only', async (phase) => {
    const run = { runId: 'run-1', childSessionId: 'child-1', title: 'Child task', activity: 'Test run', summaryPreview: 'Failure retained', executionStatus: 'failed' as const, summaryStatus: 'failed' as const, integrationStatus: 'retained' as const };
    const control = phase === 'waiting' || phase === 'waited'
      ? { phase, total: 1, completed: 0, failed: 1, cancelled: 0, needsIntegration: 1, runs: [run] }
      : { phase, total: 1, cancelled: 0, alreadyTerminal: 1, runs: [run] };
    const { readOutput, openSession } = await render({ kind: 'other', title: 'control', subagentControl: control });
    for (const text of ['总计 1', 'Child task', 'Test run', 'Failure retained', '汇总: failed', '集成: retained', '失败']) expect(container.textContent).toContain(text);
    expect(readOutput).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('"runId"');
    expect(container.querySelectorAll('button')).toHaveLength(2);
    act(() => container.querySelector<HTMLButtonElement>('.chip')?.click());
    expect(openSession).toHaveBeenCalledExactlyOnceWith('child-1');
  });

  it('shows accepted task/link without control receipt JSON or invented lifecycle', async () => {
    const { readOutput, openSession } = await render({ kind: 'subagent', title: 'start', subagentControl: { phase: 'accepted', task: 'Bounded task', runId: 'run-1', invocationId: 'inv-1', childSessionId: 'child-1' } });
    expect(container.textContent).toContain('已接受');
    expect(container.textContent).toContain('Bounded task');
    expect(container.textContent).not.toMatch(/汇总:|集成:|"runId"/);
    expect(readOutput).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('.chip')?.click());
    expect(openSession).toHaveBeenCalledExactlyOnceWith('child-1');
  });

  it('does not fabricate Goal duration/evidence when absent', async () => {
    await render({ kind: 'other', title: 'wait', goal: { phase: 'waited', reason: 'External job' } });
    expect(container.textContent).not.toMatch(/等待时长|验证证据|0 秒/);
  });
});
