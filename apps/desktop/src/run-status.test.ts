import { describe, expect, it } from 'vitest';
import { createInitialChatUiState } from './chat-reducer';
import { deriveRunStatus } from './run-status';

describe('deriveRunStatus', () => {
  it('maps aborting phase to stopping', () => {
    const chat = {
      ...createInitialChatUiState(),
      runPhase: 'aborting' as const,
      streaming: true,
    };
    const status = deriveRunStatus({ chat, tools: [], plan: null, jobs: [] });
    expect(status.kind).toBe('stopping');
    expect(status.canStop).toBe(false);
  });

  it('maps permission prompt to waiting-permission', () => {
    const chat = {
      ...createInitialChatUiState(),
      permissionPrompt: {
        requestId: 'r1',
        sessionId: 's1',
        action: 'bash',
        detail: 'rm -rf /',
        defaultDecision: 'deny' as const,
      },
    };
    const status = deriveRunStatus({ chat, tools: [], plan: null, jobs: [] });
    expect(status.kind).toBe('waiting-permission');
    expect(status.primaryAction).toBe('review-permission');
  });

  it('maps running tools to working', () => {
    const chat = {
      ...createInitialChatUiState(),
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const status = deriveRunStatus({
      chat,
      tools: [
        { toolCallId: 't1', toolName: 'read_file', status: 'running', output: '' },
        { toolCallId: 't2', toolName: 'search', status: 'done', output: 'ok' },
      ],
      plan: null,
      jobs: [],
    });
    expect(status.kind).toBe('working');
    expect(status.activeToolName).toBe('read_file');
    expect(status.completedToolCount).toBe(1);
    expect(status.canStop).toBe(true);
  });

  it('maps stopped terminal state', () => {
    const chat = {
      ...createInitialChatUiState(),
      runTerminal: { kind: 'stopped' as const, at: 1 },
    };
    const status = deriveRunStatus({ chat, tools: [], plan: null, jobs: [] });
    expect(status.kind).toBe('stopped');
  });

  it('makes slow model phases visible and keeps Stop enabled', () => {
    const chat = {
      ...createInitialChatUiState(),
      activeRunId: 'run-1',
      activeRunPhase: 'waiting-first-token' as const,
      activeRunStartedAt: Date.now() - 2_000,
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const status = deriveRunStatus({ chat, tools: [], plan: null, jobs: [] });
    expect(status.kind).toBe('waiting-first-token');
    expect(status.summary).toContain('first model token');
    expect(status.canStop).toBe(true);
    expect(status.elapsedMs).toBeGreaterThanOrEqual(2_000);
  });

  it('surfaces preparing detail for vision description', () => {
    const chat = {
      ...createInitialChatUiState(),
      activeRunId: 'run-1',
      activeRunPhase: 'preparing' as const,
      activeRunPhaseDetail: 'Describing image…',
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const status = deriveRunStatus({ chat, tools: [], plan: null, jobs: [] });
    expect(status.kind).toBe('preparing');
    expect(status.label).toBe('Describing');
    expect(status.summary).toBe('Describing image…');
  });

  it('includes planStep when planning', () => {
    const chat = {
      ...createInitialChatUiState(),
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const plan = {
      id: 'p1',
      sessionId: 's1',
      projectPath: '/tmp',
      status: 'executing' as const,
      source: 'assistant' as const,
      title: 'Implement auth',
      goal: 'Add auth',
      steps: [{ id: 's1', title: 'Add login', status: 'active' as const }],
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const status = deriveRunStatus({ chat, tools: [], plan, jobs: [] });
    expect(status.kind).toBe('planning');
    expect(status.planStep).toBe('Add login');
  });

  it('maps waiting-resource to a subtle restoring-runtime status', () => {
    const chat = {
      ...createInitialChatUiState(),
      activeRunId: 'run-1',
      activeRunPhase: 'waiting-resource' as const,
      activeRunStartedAt: Date.now() - 500,
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const status = deriveRunStatus({ chat, tools: [], plan: null, jobs: [] });
    expect(status.kind).toBe('waiting-resource');
    expect(status.label).toBe('Restoring runtime');
    expect(status.summary).toMatch(/Restoring the session runtime/);
    expect(status.canStop).toBe(true);

    const zh = deriveRunStatus({
      chat,
      tools: [],
      plan: null,
      jobs: [],
      locale: 'zh-CN',
    });
    expect(zh.label).toBe('正在恢复运行时');
    expect(zh.summary).toContain('恢复会话运行时');
  });

});
