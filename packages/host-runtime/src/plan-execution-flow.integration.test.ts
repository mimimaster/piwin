import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostPush, SessionPlan } from '@piwin/contracts';
import { extractUserFacingBody } from '@piwin/session/derive-default-name';
import { HostRuntime } from './host-runtime.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(busy = false) {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-flow-'));
  cleanups.push(() => rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const pushes: HostPush[] = [];
  const runtime = new HostRuntime({
    mode: 'sdk', mock: true, piwinRoot: rootDir,
    ...(busy ? { testFixture: 'slow-first-token' as const } : {}),
    onPush: (push) => pushes.push(push),
  });
  cleanups.push(async () => {
    try {
      await vi.waitFor(() => {
        const turns = pushes.filter((push) => push.type === 'run/updated' && push.run.kind === 'session-turn');
        for (const turn of turns) {
          if (turn.type !== 'run/updated') continue;
          expect(pushes.some((push) => push.type === 'run/terminal' && push.run.runId === turn.run.runId)).toBe(true);
        }
      }, { timeout: 10_000 });
    } finally {
      await runtime.dispose();
    }
  });
  const created = await runtime.handleCommand({
    type: 'session/create', input: { projectPath: rootDir },
  });
  if (!created.success) throw new Error(created.error);
  const sessionId = (created.data as { sessionId: string }).sessionId;
  const now = new Date().toISOString();
  const plan: SessionPlan = {
    id: 'flow-plan', sessionId, projectPath: rootDir, status: 'draft',
    title: '执行流程回归', goal: 'Complete an approved plan',
    steps: [{ id: 'one', title: 'Verify', status: 'pending' }],
    revision: 0, createdAt: now, updatedAt: now, source: 'user',
  };
  const saved = await runtime.handleCommand({ type: 'plan/set', sessionId, expected: null, plan });
  if (!saved.success) throw new Error(saved.error);
  const execute = () => runtime.handleCommand({
    type: 'plan/execute',
    request: { sessionId, planId: plan.id, mode: 'inline', approveDraft: true, expectedRevision: 0 },
  });
  return { runtime, pushes, sessionId, execute };
}

describe('plan execution handoff', () => {
  it('refuses a busy creating turn without cancelling it or mutating its plan', async () => {
    const { runtime, sessionId, pushes, execute } = await setup(true);
    const prompt = await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: '继续' } });
    expect(prompt.success).toBe(true);
    const response = await execute();
    expect(response.success).toBe(false);
    const snapshot = await runtime.handleCommand({ type: 'plan/get', sessionId });
    if (!snapshot.success) throw new Error(snapshot.error);
    expect((snapshot.data as { plan: SessionPlan }).plan).toMatchObject({ status: 'draft', revision: 0 });
    expect(pushes.some((push) => push.type === 'run/updated' && push.run.status === 'cancelling')).toBe(false);
  });

  it('does not replace a user turn admitted during the plan handoff', async () => {
    const { runtime, sessionId, pushes, execute } = await setup(true);
    const original = runtime.promptPlanSession.bind(runtime);
    vi.spyOn(runtime, 'promptPlanSession').mockImplementation(async (...args) => {
      const prompt = await runtime.handleCommand({ type: 'session/prompt', sessionId, input: { text: 'New instruction' } });
      if (!prompt.success) throw new Error(prompt.error);
      return original(...args);
    });
    const response = await execute();
    if (!response.success) throw new Error(response.error);
    const runId = (response.data as { runId: string }).runId;
    await vi.waitFor(() => {
      expect(pushes.find((push) => push.type === 'run/terminal' && push.run.runId === runId)).toMatchObject({ run: { status: 'failed', error: expect.stringContaining('foreground-run-mismatch') } });
    }, { timeout: 5_000 });
    expect(pushes.some((push) => push.type === 'run/updated' && push.run.status === 'cancelling')).toBe(false);
    const snapshot = await runtime.handleCommand({ type: 'plan/get', sessionId });
    if (!snapshot.success) throw new Error(snapshot.error);
    expect((snapshot.data as { plan: SessionPlan }).plan).toMatchObject({ status: 'approved', execution: { status: 'failed' } });
  });

  it('runs inline to completion with a readable transcript and direct-execution instructions', async () => {
    const { runtime, sessionId, pushes, execute } = await setup();
    const session = await runtime.ensureLiveSession(sessionId);
    const originalPrompt = session.prompt.bind(session);
    const prompt = vi.spyOn(session, 'prompt').mockImplementation(async (input) => {
      const active = await runtime.handleCommand({ type: 'plan/update-step', sessionId, stepId: 'one', status: 'active' });
      if (!active.success) throw new Error(active.error);
      const result = await originalPrompt(input);
      const done = await runtime.handleCommand({ type: 'plan/update-step', sessionId, stepId: 'one', status: 'done', detail: 'Mock turn and step transition verified' });
      if (!done.success) throw new Error(done.error);
      return result;
    });
    const response = await execute();
    if (!response.success) throw new Error(response.error);
    const runId = (response.data as { runId: string }).runId;
    await vi.waitFor(() => {
      const terminal = pushes.find((push) => push.type === 'run/terminal' && push.run.runId === runId);
      expect(terminal, JSON.stringify({ terminal, calls: prompt.mock.calls.length })).toMatchObject({ run: { status: 'completed' } });
    }, { timeout: 5_000 });
    const sent = prompt.mock.calls[0]?.[0];
    expect(sent?.text).toContain('Do not spawn subagents');
    const messages = await runtime.loadTranscriptMessages(sessionId);
    const user = messages.find((message) => message.role === 'user');
    expect(extractUserFacingBody(user?.text ?? '')).toContain('执行流程回归');
    const snapshot = await runtime.handleCommand({ type: 'plan/get', sessionId });
    if (!snapshot.success) throw new Error(snapshot.error);
    expect((snapshot.data as { plan: SessionPlan }).plan).toMatchObject({ status: 'done', execution: { status: 'completed' } });
  });
});
