import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PromptInput } from '@piwin/contracts';
import { loadSessionPlan, saveSessionPlan } from '@piwin/session';
import { getPiwinSessionPlanPath } from '../paths.js';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { createPromptContext } from './session-live-test-context.js';

describe('prompt plan context degradation', () => {
  it('still calls liveSession.prompt when plan.json is corrupt', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-corrupt-plan-'));
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => false;
    let promptCalls = 0;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      promptCalls += 1;
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const planPath = getPiwinSessionPlanPath(rootDir, session.id);
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(planPath, '{not-json', 'utf8');

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'continue the work' },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(promptCalls).toBe(1);
    });
    expect(modelFacingText).toContain('continue the work');
    expect(modelFacingText).not.toContain('not-json');
    expect(
      events.some(
        (event) =>
          event.type === 'host/log' &&
          event.level === 'warn' &&
          event.message.includes('session plan load failed'),
      ),
    ).toBe(false);
  });

  it('approves a draft when the user selects one execution mode in a normal prompt', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-plan-selection-'));
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => false;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const planPath = getPiwinSessionPlanPath(rootDir, session.id);
    const now = new Date().toISOString();
    await saveSessionPlan(planPath, {
      id: 'selection-plan',
      sessionId: session.id,
      projectPath: '/tmp/project',
      status: 'draft',
      title: 'Mode selection',
      goal: 'Execute after the user chooses a mode',
      steps: [{ id: '1', title: 'Verify', status: 'pending' }],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      source: 'assistant',
    });

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'inline' },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(modelFacingText).toContain('[piwin plan context v2');
    });
    expect(modelFacingText).toContain('Status: approved');
    expect(modelFacingText).toContain(`Plan file: ${planPath}`);
    expect(modelFacingText).toContain('execute the plan directly in this session');
    expect(await loadSessionPlan(planPath)).toMatchObject({
      id: 'selection-plan',
      status: 'approved',
      revision: 1,
      execution: { mode: 'inline', status: 'idle' },
    });
    expect(
      events.some((event) => event.type === 'plan/updated' && event.plan?.status === 'approved'),
    ).toBe(true);
  });

  it('does not approve a draft from 执行一下', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-plan-vague-'));
    const session = createDelayedSessionHandle();
    const { context } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => false;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const planPath = getPiwinSessionPlanPath(rootDir, session.id);
    const now = new Date().toISOString();
    await saveSessionPlan(planPath, {
      id: 'vague-plan',
      sessionId: session.id,
      projectPath: '/tmp/project',
      status: 'draft',
      title: 'Needs a mode',
      goal: 'Stay draft until a mode is chosen',
      steps: [{ id: '1', title: 'Verify', status: 'pending' }],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      source: 'assistant',
    });

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: '执行一下' },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(modelFacingText).toContain('执行一下');
    });
    expect(modelFacingText).not.toContain('[piwin plan context v2');
    expect(await loadSessionPlan(planPath)).toMatchObject({
      id: 'vague-plan',
      status: 'draft',
      revision: 0,
    });
  });

  it('reuses the stored mode when the user asks to execute an approved plan', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-plan-reuse-'));
    const session = createDelayedSessionHandle();
    const { context } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => false;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const planPath = getPiwinSessionPlanPath(rootDir, session.id);
    const now = new Date().toISOString();
    await saveSessionPlan(planPath, {
      id: 'reuse-plan',
      sessionId: session.id,
      projectPath: '/tmp/project',
      status: 'approved',
      title: 'Already chosen',
      goal: 'Continue without repeating keywords',
      steps: [{ id: '1', title: 'Verify', status: 'pending' }],
      revision: 1,
      createdAt: now,
      updatedAt: now,
      source: 'assistant',
      execution: {
        sessionId: session.id,
        planId: 'reuse-plan',
        mode: 'subagent-driven',
        status: 'idle',
        childSessionIds: [],
      },
    });

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: '执行一下' },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(modelFacingText).toContain('[piwin plan context v2');
    });
    expect(modelFacingText).toContain('Status: approved');
    expect(modelFacingText).toContain('Chosen execution mode: subagent-driven.');
    expect(modelFacingText).toContain(
      'delegate eligible plan steps to subagents, then summarize and verify their results',
    );
    expect(await loadSessionPlan(planPath)).toMatchObject({
      id: 'reuse-plan',
      status: 'approved',
      execution: { mode: 'subagent-driven' },
    });
  });
});
