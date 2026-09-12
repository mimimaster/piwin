// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  SubagentInvocation,
  SubagentResultSummary,
  SubagentReviewFinding,
  SubagentReviewRecord,
} from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { deriveSubagentReviewLoopView } from './subagent-orchestration-view';
import { resolveSubagentReviewActionGate } from './subagent-review-summary-model';
import { SubagentReviewSummary } from './subagent-review-summary';

const PARENT = 'parent-1';
const WORKER = 'child-worker';
const LINEAGE = 'lineage-login';

function finding(
  id: string,
  title: string,
  overrides: Partial<SubagentReviewFinding> = {},
): SubagentReviewFinding {
  return {
    id,
    severity: 'high',
    title,
    detail: `${title} detail`,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<SubagentResultSummary> & Pick<SubagentResultSummary, 'resultId'>,
): SubagentResultSummary {
  return {
    revision: 1,
    parentSessionId: PARENT,
    childSessionId: WORKER,
    taskId: 'task-worker-1',
    batchRunId: 'run-worker-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    candidateLineageId: LINEAGE,
    candidateGeneration: 1,
    predecessorResult: null,
    latestReview: null,
    reviewStatus: 'not-requested',
    latestVerification: null,
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-1', revision: 1 },
    appliedChanges: null,
    copyState: 'present',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
    ...overrides,
  };
}

function makeInvocation(
  overrides: Partial<SubagentInvocation> & Pick<SubagentInvocation, 'id' | 'status'>,
): SubagentInvocation {
  return {
    parentSessionId: PARENT,
    runId: 'run-worker-1',
    taskId: 'task-worker-1',
    task: 'Fix login state',
    title: 'Fix login state',
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    activity: { kind: 'completed' },
    ...overrides,
  };
}

function makeReview(
  overrides: Partial<SubagentReviewRecord> &
    Pick<SubagentReviewRecord, 'reviewId' | 'decision' | 'targetResult'>,
): SubagentReviewRecord {
  return {
    revision: 1,
    parentSessionId: PARENT,
    reviewerSessionId: 'child-reviewer-1',
    reviewerRunId: 'run-reviewer-1',
    targetChanges: { changeSetId: 'cs-1', revision: 1 },
    findings: [],
    verification: [],
    createdAt: '2026-09-13T00:02:00.000Z',
    ...overrides,
  };
}

function loopFacts() {
  const v1 = makeResult({
    resultId: 'result-v1',
    latestReview: { reviewId: 'review-v1', revision: 1 },
    reviewStatus: 'changes-requested',
    revision: 2,
    availability: {
      view: { allowed: true },
      apply: { allowed: false, reason: 'candidate-superseded' },
      resolve: { allowed: false, reason: 'candidate-superseded' },
      cleanup: { allowed: true },
    },
  });
  const v2 = makeResult({
    resultId: 'result-v2',
    taskId: 'task-worker-2',
    batchRunId: 'run-worker-2',
    candidateGeneration: 2,
    predecessorResult: { resultId: 'result-v1', revision: 2 },
    latestReview: { reviewId: 'review-v2', revision: 1 },
    reviewStatus: 'approved',
    childChanges: { changeSetId: 'cs-2', revision: 1 },
    revision: 3,
  });
  const worker = makeInvocation({
    id: 'inv-worker-v1',
    status: 'completed',
    role: 'worker',
    childSessionId: WORKER,
    candidateLineageId: LINEAGE,
    candidateGeneration: 1,
  });
  const reviewerV1 = makeInvocation({
    id: 'inv-reviewer-v1',
    status: 'completed',
    runId: 'run-reviewer-1',
    taskId: 'task-reviewer-1',
    task: 'Review candidate v1',
    title: 'Review candidate v1',
    childSessionId: 'child-reviewer-1',
    role: 'reviewer',
    reviewTarget: {
      result: { resultId: 'result-v1', revision: 2 },
      changes: { changeSetId: 'cs-1', revision: 1 },
    },
    reviewRef: { reviewId: 'review-v1', revision: 1 },
  });
  const repair = makeInvocation({
    id: 'inv-repair-v2',
    status: 'completed',
    role: 'worker',
    childSessionId: WORKER,
    runId: 'run-worker-2',
    taskId: 'task-worker-2',
    candidateLineageId: LINEAGE,
    candidateGeneration: 2,
    predecessorResult: { resultId: 'result-v1', revision: 2 },
  });
  const reviewerV2 = makeInvocation({
    id: 'inv-reviewer-v2',
    status: 'completed',
    runId: 'run-reviewer-2',
    taskId: 'task-reviewer-2',
    task: 'Review candidate v2',
    title: 'Review candidate v2',
    childSessionId: 'child-reviewer-2',
    role: 'reviewer',
    reviewTarget: {
      result: { resultId: 'result-v2', revision: 3 },
      changes: { changeSetId: 'cs-2', revision: 1 },
    },
    reviewRef: { reviewId: 'review-v2', revision: 1 },
  });
  const reviewV1 = makeReview({
    reviewId: 'review-v1',
    decision: 'changes-requested',
    targetResult: { resultId: 'result-v1', revision: 2 },
    findings: [
      finding('f-low', 'Nit', { severity: 'low' }),
      finding('f-high', 'Missing null check', {
        severity: 'high',
        relativePath: 'src/auth.ts',
        line: 12,
      }),
      finding('f-unsafe', 'Secret path', { relativePath: '../etc/passwd', line: 1 }),
    ],
  });
  const reviewV2 = makeReview({
    reviewId: 'review-v2',
    decision: 'approved',
    reviewerSessionId: 'child-reviewer-2',
    reviewerRunId: 'run-reviewer-2',
    targetResult: { resultId: 'result-v2', revision: 3 },
    targetChanges: { changeSetId: 'cs-2', revision: 1 },
  });
  return {
    v1,
    v2,
    reviews: { [reviewV1.reviewId]: reviewV1, [reviewV2.reviewId]: reviewV2 },
    invocations: {
      [worker.id]: worker,
      [reviewerV1.id]: reviewerV1,
      [repair.id]: repair,
      [reviewerV2.id]: reviewerV2,
    },
    results: { [v1.resultId]: v1, [v2.resultId]: v2 },
  };
}

function deriveLoop(
  overrides: Partial<Parameters<typeof deriveSubagentReviewLoopView>[0]> = {},
) {
  const facts = loopFacts();
  const view = deriveSubagentReviewLoopView({
    parentSessionId: PARENT,
    invocations: facts.invocations,
    results: facts.results,
    reviews: facts.reviews,
    ...overrides,
  });
  const loop = view.loops[0];
  if (loop === undefined) {
    throw new Error('expected a review loop');
  }
  return { facts, loop };
}

describe('SubagentReviewSummary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderSummary(
    overrides: Partial<Parameters<typeof SubagentReviewSummary>[0]> = {},
  ): ReturnType<typeof deriveLoop> {
    const derived = deriveLoop();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentReviewSummary
            loop={derived.loop}
            locale="zh-CN"
            reviews={derived.facts.reviews}
            results={derived.facts.results}
            onApply={vi.fn()}
            onRequestResolution={vi.fn()}
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
    return derived;
  }

  it('changes-requested findings expand under the correct candidate', () => {
    renderSummary();
    const v1Review = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-invocation-id="inv-reviewer-v1"]',
    );
    const v2Review = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-invocation-id="inv-reviewer-v2"]',
    );
    expect(v1Review?.textContent).toContain('审查：');
    expect(v1Review?.textContent).toContain('候选 v1');
    expect(v1Review?.textContent).toContain('需修改 · 3 项');
    expect(v1Review?.getAttribute('data-depth')).toBe('1');

    const expand = v1Review?.querySelector<HTMLButtonElement>('[data-testid="subagent-review-expand"]');
    expect(expand).not.toBeNull();
    act(() => {
      expand?.click();
    });

    const findings = v1Review?.querySelectorAll('[data-testid="subagent-review-finding"]');
    expect(findings?.length).toBe(3);
    expect(findings?.[0]?.getAttribute('data-finding-id')).toBe('f-high');
    expect(findings?.[0]?.textContent).toContain('src/auth.ts:12');
    expect(findings?.[0]?.textContent).not.toContain('../etc/passwd');
    expect(v2Review?.querySelector('[data-testid="subagent-review-finding"]')).toBeNull();
    expect(v2Review?.textContent).toContain('已批准');
    expect(v2Review?.textContent).not.toContain('Missing null check');
  });

  it('keyboard-activates expand without inspecting the child', () => {
    const onInspect = vi.fn();
    renderSummary({ onInspect });
    const v1Review = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-invocation-id="inv-reviewer-v1"]',
    );
    const rowMain = v1Review?.querySelector('.subagent-review-loop-row-main');
    expect(rowMain?.getAttribute('role')).toBeNull();
    expect(rowMain?.getAttribute('tabindex')).toBeNull();

    act(() => {
      rowMain?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onInspect).not.toHaveBeenCalled();

    const expand = v1Review?.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-review-expand"]',
    );
    expect(expand?.tagName).toBe('BUTTON');
    act(() => {
      expand?.click();
    });
    expect(onInspect).not.toHaveBeenCalled();
    expect(v1Review?.querySelectorAll('[data-testid="subagent-review-finding"]').length).toBe(3);

    const inspect = v1Review?.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-review-inspect"]',
    );
    act(() => {
      inspect?.click();
    });
    expect(onInspect).toHaveBeenCalledTimes(1);
  });

  it('expands findings from taskResults.review without a reviews prop', () => {
    const facts = loopFacts();
    const reviewV1 = facts.reviews['review-v1'];
    if (reviewV1 === undefined) {
      throw new Error('expected review-v1');
    }
    const taskResults = {
      'run-reviewer-1:task-reviewer-1': {
        runId: 'run-reviewer-1',
        taskId: 'task-reviewer-1',
        childSessionId: 'child-reviewer-1',
        executionStatus: 'completed' as const,
        summaryStatus: 'merged' as const,
        integrationStatus: 'not-requested' as const,
        review: reviewV1,
      },
    };
    const loop = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: facts.invocations,
      results: facts.results,
      taskResults,
    }).loops[0];
    if (loop === undefined) {
      throw new Error('expected a review loop');
    }
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentReviewSummary
            loop={loop}
            locale="zh-CN"
            taskResults={taskResults}
            results={facts.results}
          />
        </PiwinUiProvider>,
      );
    });
    const v1Review = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-invocation-id="inv-reviewer-v1"]',
    );
    const expand = v1Review?.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-review-expand"]',
    );
    expect(expand).not.toBeNull();
    act(() => {
      expand?.click();
    });
    const findings = v1Review?.querySelectorAll('[data-testid="subagent-review-finding"]');
    expect(findings?.length).toBe(3);
    expect(findings?.[0]?.getAttribute('data-finding-id')).toBe('f-high');
    expect(findings?.[0]?.textContent).toContain('src/auth.ts:12');
  });

  it('continuation remains the same worker identity with v2 label', () => {
    renderSummary();
    const v1 = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-invocation-id="inv-worker-v1"]',
    );
    const repair = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-invocation-id="inv-repair-v2"]',
    );
    expect(v1?.getAttribute('data-child-session-id')).toBe(WORKER);
    expect(repair?.getAttribute('data-child-session-id')).toBe(WORKER);
    expect(repair?.getAttribute('data-run-id')).toBe('run-worker-2');
    expect(repair?.getAttribute('data-candidate-generation')).toBe('2');
    expect(repair?.textContent).toContain('返工：');
    expect(repair?.textContent).toContain('已产出候选 v2');
    expect(v1?.textContent).toContain('已产出候选 v1');
  });

  it('changes-requested head keeps apply disabled', () => {
    const facts = loopFacts();
    const worker = facts.invocations['inv-worker-v1'];
    const reviewer = facts.invocations['inv-reviewer-v1'];
    const review = facts.reviews['review-v1'];
    if (worker === undefined || reviewer === undefined || review === undefined) {
      throw new Error('expected v1 loop facts');
    }
    const head = {
      ...facts.v1,
      availability: {
        view: { allowed: true },
        apply: { allowed: true },
        resolve: { allowed: true },
        cleanup: { allowed: true },
      },
    };
    const view = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: { [worker.id]: worker, [reviewer.id]: reviewer },
      results: { [head.resultId]: head },
      reviews: { [review.reviewId]: review },
    });
    const loop = view.loops[0];
    const row = loop?.rows.find(
      (candidate) => candidate.resultId === head.resultId && candidate.kind !== 'review',
    );
    if (loop === undefined || row === undefined) {
      throw new Error('expected changes-requested head row');
    }
    expect(
      resolveSubagentReviewActionGate({
        loop,
        row,
        result: head,
        locale: 'zh-CN',
      }).applyEnabled,
    ).toBe(false);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentReviewSummary
            loop={loop}
            locale="zh-CN"
            reviews={{ [review.reviewId]: review }}
            results={{ [head.resultId]: head }}
            onApply={vi.fn()}
            onRequestResolution={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });
    const apply = container.querySelector<HTMLButtonElement>('[data-testid="subagent-review-apply"]');
    expect(apply?.disabled).toBe(true);
    expect(container.textContent).toContain('需先批准');
  });

  it('stale v1 approval disables apply and points to v2', () => {
    const { facts, loop } = deriveLoop();
    const storedV1 = facts.results['result-v1'];
    if (storedV1 === undefined) {
      throw new Error('expected v1 result');
    }
    const approvedV1 = {
      ...storedV1,
      reviewStatus: 'approved' as const,
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentReviewSummary
            loop={loop}
            locale="zh-CN"
            reviews={facts.reviews}
            results={{ ...facts.results, 'result-v1': approvedV1 }}
            onApply={vi.fn()}
            onRequestResolution={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });
    const v1 = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-result-id="result-v1"][data-row-kind="candidate"]',
    );
    const apply = v1?.querySelector<HTMLButtonElement>('[data-testid="subagent-review-apply"]');
    expect(apply?.disabled).toBe(true);
    expect(v1?.textContent).toContain('请使用候选 v2');
    const v2 = container.querySelector(
      '[data-testid="subagent-review-loop-row"][data-result-id="result-v2"][data-row-kind="repair"]',
    );
    expect(v2?.querySelector<HTMLButtonElement>('[data-testid="subagent-review-apply"]')?.disabled).toBe(
      false,
    );
  });

  it('applied-but-verification-failed remains visibly incomplete', () => {
    const facts = loopFacts();
    const applied = makeResult({
      ...facts.v2,
      resultId: 'result-v2',
      integrationStatus: 'applied',
      appliedChanges: { changeSetId: 'cs-parent', revision: 1 },
      latestOperationId: 'op-1',
      latestVerification: { verificationId: 'verify-1', revision: 1 },
      revision: 4,
    });
    const failed = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: facts.invocations,
      results: { ...facts.results, 'result-v2': applied },
      reviews: facts.reviews,
      verifications: {
        'verify-1': {
          verificationId: 'verify-1',
          revision: 1,
          resultId: 'result-v2',
          status: 'failed',
        },
      },
    }).loops[0];
    if (failed === undefined) {
      throw new Error('expected failed loop');
    }
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentReviewSummary loop={failed} locale="zh-CN" reviews={facts.reviews} />
        </PiwinUiProvider>,
      );
    });
    const rootNode = container.querySelector('[data-testid="subagent-review-summary"]');
    expect(rootNode?.getAttribute('data-applied')).toBe('true');
    expect(rootNode?.getAttribute('data-delivered')).toBe('false');
    expect(rootNode?.getAttribute('data-incomplete')).toBe('true');
    expect(container.querySelector('[data-testid="subagent-review-verification-status"]')?.textContent).toBe(
      '验证失败（未完成）',
    );
    expect(container.textContent).not.toContain('已通过');
    expect(container.querySelector('[data-testid="subagent-review-delivered-badge"]')).toBeNull();

    const verifying = deriveSubagentReviewLoopView({
      parentSessionId: PARENT,
      invocations: facts.invocations,
      results: {
        ...facts.results,
        'result-v2': { ...applied, latestVerification: null, revision: 5 },
      },
      reviews: facts.reviews,
    }).loops[0];
    if (verifying === undefined) {
      throw new Error('expected verifying loop');
    }
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentReviewSummary loop={verifying} locale="zh-CN" reviews={facts.reviews} />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="subagent-review-verification-status"]')?.textContent).toBe(
      '正在验证',
    );
    expect(container.textContent).not.toContain('已通过');
  });
});
