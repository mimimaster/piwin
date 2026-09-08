import { chmod, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostPush, SessionPlan, SubagentBatchResult } from '@piwin/contracts';
import {
  loadSessionPlan,
  saveSessionPlan,
  updateSessionPlan,
} from '@piwin/session';
import { getPiwinSessionPlanPath } from '../paths.js';
import { handlePlanCommand } from './plan-commands.js';
import type { HostCommandContext, PlanExecutionSeam } from './host-command-context.js';

const loadHold = vi.hoisted(() => {
  const state = {
    current: Promise.resolve() as Promise<void>,
    entered: Promise.resolve() as Promise<void>,
    markEntered: (): void => undefined,
  };
  return state;
});

vi.mock('@piwin/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@piwin/session')>();
  return {
    ...actual,
    loadSessionPlan: async (filePath: string) => {
      const plan = await actual.loadSessionPlan(filePath);
      loadHold.markEntered();
      await loadHold.current;
      return plan;
    },
  };
});

afterEach(() => {
  loadHold.current = Promise.resolve();
  loadHold.entered = Promise.resolve();
  loadHold.markEntered = (): void => undefined;
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function approvedPlan(sessionId: string, extras: Partial<SessionPlan> = {}): SessionPlan {
  const now = new Date().toISOString();
  return {
    id: 'plan-1',
    sessionId,
    projectPath: '/tmp/proj',
    status: 'approved',
    title: 'Ship',
    goal: 'Do the work',
    steps: [{ id: '1', title: 'One', status: 'pending' }],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    source: 'user',
    ...extras,
  };
}

function createContext(
  rootDir: string,
  seam: PlanExecutionSeam,
): { context: HostCommandContext; pushes: HostPush[]; finished: Array<{ runId: string; status: string; error?: string }> } {
  const pushes: HostPush[] = [];
  const finished: Array<{ runId: string; status: string; error?: string }> = [];
  const wrapped: PlanExecutionSeam = {
    ...seam,
    finishPlanRun: (runId, status, error) => {
      finished.push(error === undefined ? { runId, status } : { runId, status, error });
      seam.finishPlanRun?.(runId, status, error);
    },
  };
  return {
    pushes,
    finished,
    context: {
      piwinRoot: rootDir,
      push: (message) => {
        pushes.push(message);
      },
      planExecution: wrapped,
    } as HostCommandContext,
  };
}

describe('plan command admission and execution identity', () => {
  it('rejects execute after precheck when another writer bumps revision before the lock', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-admit-'));
    const sessionId = 'session-admit';
    const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
    await saveSessionPlan(planPath, approvedPlan(sessionId));
    let releaseLoad = (): void => undefined;
    loadHold.current = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    loadHold.entered = new Promise<void>((resolve) => {
      loadHold.markEntered = resolve;
    });
    const promptCalls: string[] = [];
    const { context, finished } = createContext(rootDir, {
      promptSession: async (_sessionId, text) => {
        promptCalls.push(text);
        return { runId: 'prompt-1', finalAssistantMessageId: 'a1' };
      },
      abortSession: async () => undefined,
      runBatch: async () => ({ runId: 'batch-1', status: 'completed', results: [] }),
      startPlanRun: () => ({ runId: 'plan-run-1' }),
    });

    const executePromise = handlePlanCommand(
      {
        type: 'plan/execute',
        request: { sessionId, planId: 'plan-1', mode: 'inline', expectedRevision: 0 },
      },
      'req-1',
      context,
    );
    await loadHold.entered;
    await updateSessionPlan(planPath, (current) =>
      current ? { ...current, title: `${current.title} edited` } : null,
    );
    releaseLoad();
    const response = await executePromise;
    expect(response?.success).toBe(false);
    if (response && response.success === false) {
      expect(response.error).toContain('revision mismatch');
    }
    expect(promptCalls).toEqual([]);
    expect(finished[0]).toMatchObject({ runId: 'plan-run-1', status: 'failed' });
    expect(finished[0]?.error).toContain('revision mismatch');
  });

  it('does not start verification when abort wins and a late batch returns completed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-abort-late-'));
    const sessionId = 'session-abort';
    const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
    await saveSessionPlan(
      planPath,
      approvedPlan(sessionId, { independentSteps: ['1'] }),
    );
    let releaseBatch: (result: SubagentBatchResult) => void = () => undefined;
    const batchStarted = createDeferred<void>();
    const batchResult = new Promise<SubagentBatchResult>((resolve) => {
      releaseBatch = resolve;
    });
    const promptCalls: string[] = [];
    const { context, finished } = createContext(rootDir, {
      promptSession: async (_sessionId, text) => {
        promptCalls.push(text);
        return { runId: 'prompt-1', finalAssistantMessageId: 'a1' };
      },
      abortSession: async () => undefined,
      runBatch: async () => {
        batchStarted.resolve();
        return batchResult;
      },
      startPlanRun: () => ({ runId: 'plan-run-1' }),
      cancelPlanRun: () => undefined,
    });

    const executeResponse = await handlePlanCommand(
      {
        type: 'plan/execute',
        request: { sessionId, planId: 'plan-1', mode: 'subagent-driven' },
      },
      'req-1',
      context,
    );
    expect(executeResponse?.success).toBe(true);
    await batchStarted.promise;
    const abortResponse = await handlePlanCommand(
      { type: 'plan/abort', sessionId, planId: 'plan-1' },
      'req-2',
      context,
    );
    expect(abortResponse?.success).toBe(true);
    releaseBatch({
      runId: 'batch-1',
      status: 'completed',
      results: [
        {
          runId: 'child-run',
          taskId: '1',
          childSessionId: 'child-1',
          executionStatus: 'completed',
          summaryStatus: 'merged',
          integrationStatus: 'applied',
        },
      ],
    });
    await vi.waitFor(() => {
      expect(finished.some((entry) => entry.runId === 'plan-run-1')).toBe(true);
    });
    const loaded = await loadSessionPlan(planPath);
    expect(loaded?.status).toBe('abandoned');
    expect(loaded?.execution?.status).toBe('aborted');
    expect(promptCalls.some((text) => text.includes('verification') || text.includes('Verify'))).toBe(
      false,
    );
  });

  it('ignores a stale execution callback after the same plan is re-executed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-stale-cb-'));
    const sessionId = 'session-stale-cb';
    const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
    await saveSessionPlan(
      planPath,
      approvedPlan(sessionId, { independentSteps: ['1'] }),
    );
    const firstBatch = createDeferred<SubagentBatchResult>();
    const firstStarted = createDeferred<void>();
    const secondStarted = createDeferred<void>();
    let startCount = 0;
    const { context } = createContext(rootDir, {
      promptSession: async () => ({ runId: 'prompt', finalAssistantMessageId: 'a1' }),
      abortSession: async () => undefined,
      runBatch: async (_request, parentRunId) => {
        if (parentRunId === 'plan-run-1') {
          firstStarted.resolve();
          return firstBatch.promise;
        }
        secondStarted.resolve();
        return {
          runId: 'batch-2',
          status: 'completed',
          results: [],
        };
      },
      startPlanRun: () => {
        startCount += 1;
        return { runId: `plan-run-${startCount}` };
      },
      cancelPlanRun: () => undefined,
    });

    await handlePlanCommand(
      {
        type: 'plan/execute',
        request: { sessionId, planId: 'plan-1', mode: 'subagent-driven' },
      },
      undefined,
      context,
    );
    await firstStarted.promise;
    await handlePlanCommand(
      { type: 'plan/abort', sessionId, planId: 'plan-1' },
      undefined,
      context,
    );
    await updateSessionPlan(planPath, (current) =>
      current ? { ...current, status: 'approved' as const } : null,
    );
    await handlePlanCommand(
      {
        type: 'plan/execute',
        request: { sessionId, planId: 'plan-1', mode: 'subagent-driven' },
      },
      undefined,
      context,
    );
    await secondStarted.promise;
    firstBatch.resolve({
      runId: 'batch-1',
      status: 'completed',
      results: [
        {
          runId: 'child-run',
          taskId: '1',
          childSessionId: 'stale-child',
          executionStatus: 'completed',
          summaryStatus: 'merged',
          integrationStatus: 'applied',
        },
      ],
    });
    await vi.waitFor(async () => {
      const loaded = await loadSessionPlan(planPath);
      expect(loaded?.execution?.runId).toBe('plan-run-2');
    });
    const loaded = await loadSessionPlan(planPath);
    expect(loaded?.execution?.childSessionIds ?? []).not.toContain('stale-child');
  });

  it('terminals the reserved Run when the admission write cannot persist', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-writefail-'));
    const sessionId = 'session-writefail';
    const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
    await saveSessionPlan(planPath, approvedPlan(sessionId));
    const sessionDir = dirname(planPath);
    const { context, finished } = createContext(rootDir, {
      promptSession: async () => ({ runId: 'prompt', finalAssistantMessageId: 'a1' }),
      abortSession: async () => undefined,
      runBatch: async () => ({ runId: 'batch', status: 'completed', results: [] }),
      startPlanRun: () => ({ runId: 'plan-run-1' }),
    });
    await chmod(sessionDir, 0o555);
    try {
      const response = await handlePlanCommand(
        {
          type: 'plan/execute',
          request: { sessionId, planId: 'plan-1', mode: 'inline' },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(false);
      expect(finished).toEqual([
        expect.objectContaining({ runId: 'plan-run-1', status: 'failed' }),
      ]);
    } finally {
      await chmod(sessionDir, 0o755);
    }
  });
});
