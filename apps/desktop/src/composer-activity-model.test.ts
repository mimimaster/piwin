import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@piwin/contracts';
import { shouldRefreshJobList } from './composer-activity-actions';
import {
  collectComposerActivityStopAllTargets,
  deriveComposerActivityModel,
  EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
  formatComposerActivityLabel,
} from './composer-activity-model';
import type { SubagentOrchestrationItem, SubagentOrchestrationView } from './subagent-orchestration-view';

function makeItem(
  overrides: Partial<SubagentOrchestrationItem> & Pick<SubagentOrchestrationItem, 'anchorId'>,
): SubagentOrchestrationItem {
  return {
    title: overrides.title ?? overrides.anchorId,
    activity: 'Running tool',
    executionStatus: 'running',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'service',
    lifetime: 'session',
    command: 'node',
    argv: ['node', 'server.js'],
    cwd: '/project',
    status: 'running',
    ownerSessionId: 'session-1',
    startedAt: '2026-09-13T00:00:00.000Z',
    latestLogCursor: 0,
    ...overrides,
  };
}

function viewFromItems(items: SubagentOrchestrationItem[]): SubagentOrchestrationView {
  return {
    ...EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
    items,
    activeCount: items.filter(
      (item) =>
        item.executionStatus === 'queued' ||
        item.executionStatus === 'starting' ||
        item.executionStatus === 'running',
    ).length,
    completedCount: items.filter((item) => item.executionStatus === 'completed').length,
  };
}

describe('deriveComposerActivityModel', () => {
  it('hides the pill when nothing is active or needs attention', () => {
    const model = deriveComposerActivityModel({
      orchestration: viewFromItems([
        makeItem({
          anchorId: 'done',
          executionStatus: 'completed',
          title: 'Done',
        }),
      ]),
      jobs: [],
      locale: 'en',
    });
    expect(model.visible).toBe(false);
    expect(model.workingCount).toBe(0);
  });

  it('counts running invocations and live jobs, including ready services', () => {
    const model = deriveComposerActivityModel({
      orchestration: viewFromItems([
        makeItem({ anchorId: 'a', title: 'Scout', runId: 'run-1' }),
        makeItem({ anchorId: 'b', title: 'Writer', runId: 'run-1' }),
      ]),
      jobs: [makeJob({ status: 'ready', argv: ['vite', '--port', '5173'] })],
      locale: 'en',
    });
    expect(model.visible).toBe(true);
    expect(model.workingCount).toBe(3);
    expect(model.label).toBe('3 Working');
    expect(model.spinning).toBe(true);
  });

  it('uses a mixed label when finished items still sit in the F1 view', () => {
    const model = deriveComposerActivityModel({
      orchestration: viewFromItems([
        makeItem({ anchorId: 'live', title: 'Scout', runId: 'run-1' }),
        makeItem({
          anchorId: 'done',
          title: 'Writer',
          executionStatus: 'completed',
        }),
      ]),
      jobs: [],
      locale: 'zh-CN',
    });
    expect(model.label).toBe('1 运行中 · 1 完成');
  });

  it('stays visible for failed work that still needs attention', () => {
    const model = deriveComposerActivityModel({
      orchestration: viewFromItems([
        makeItem({
          anchorId: 'fail',
          title: 'Scout',
          executionStatus: 'failed',
        }),
      ]),
      jobs: [],
      locale: 'en',
    });
    expect(model.visible).toBe(true);
    expect(model.attentionCount).toBe(1);
    expect(model.label).toBe('1 failed');
  });
});

describe('formatComposerActivityLabel', () => {
  it('formats working and mixed bilingual labels', () => {
    expect(
      formatComposerActivityLabel({ workingCount: 5, finishedCount: 0, locale: 'en' }),
    ).toBe('5 Working');
    expect(
      formatComposerActivityLabel({ workingCount: 2, finishedCount: 0, locale: 'zh-CN' }),
    ).toBe('2 运行中');
  });

  it('does not count failed or stopped children as done', () => {
    expect(
      formatComposerActivityLabel({
        workingCount: 1,
        finishedCount: 3,
        failedCount: 3,
        locale: 'zh-CN',
      }),
    ).toBe('1 运行中 · 3 失败');
    expect(
      formatComposerActivityLabel({
        workingCount: 0,
        finishedCount: 4,
        failedCount: 1,
        cancelledCount: 1,
        locale: 'en',
      }),
    ).toBe('2 done · 1 failed · 1 stopped');
  });
});

describe('shouldRefreshJobList', () => {
  it('refreshes whenever job/list is supported and a session is active', () => {
    expect(shouldRefreshJobList({ supportsJobList: true, hasActiveSession: true })).toBe(true);
    expect(shouldRefreshJobList({ supportsJobList: true, hasActiveSession: false })).toBe(false);
    expect(shouldRefreshJobList({ supportsJobList: false, hasActiveSession: true })).toBe(false);
  });
});

describe('collectComposerActivityStopAllTargets', () => {
  it('dedupes batch run ids and lists live jobs', () => {
    const targets = collectComposerActivityStopAllTargets({
      items: [
        makeItem({ anchorId: 'a', runId: 'run-1' }),
        makeItem({ anchorId: 'b', runId: 'run-1' }),
        makeItem({
          anchorId: 'c',
          runId: 'run-2',
          executionStatus: 'completed',
        }),
      ],
      jobs: [makeJob({ jobId: 'job-1' }), makeJob({ jobId: 'job-2' })],
    });
    expect(targets.runIds).toEqual(['run-1']);
    expect(targets.jobIds).toEqual(['job-1', 'job-2']);
  });
});
