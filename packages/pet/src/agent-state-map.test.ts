import { describe, expect, it } from 'vitest';
import {
  createInitialPetAgentContext,
  petStateFromChatFlags,
  reducePetAgentContext,
} from './agent-state-map.js';

describe('reducePetAgentContext', () => {
  it('goes running while assistant streams', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, { type: 'message/start', messageId: 'm1', role: 'assistant' });
    expect(ctx.state).toBe('running');
    ctx = reducePetAgentContext(ctx, { type: 'message/end', messageId: 'm1' });
    expect(ctx.state).toBe('idle');
  });

  it('goes waiting on permission request', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, {
      type: 'permission/request',
      requestId: 'p1',
      action: 'bash',
      detail: 'rm -rf',
      defaultDecision: 'ask',
    });
    expect(ctx.state).toBe('waiting');
  });

  it('goes failed on error', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, { type: 'error', message: 'boom' });
    expect(ctx.state).toBe('failed');
  });

  it('captures active tool name on tool/start and clears on tool/end', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, {
      type: 'tool/start',
      toolCallId: 't1',
      toolName: 'read_file',
    });
    expect(ctx.activeToolName).toBe('read_file');
    expect(ctx.state).toBe('running');
    ctx = reducePetAgentContext(ctx, { type: 'tool/end', toolCallId: 't1', isError: false });
    expect(ctx.activeToolName).toBeNull();
    expect(ctx.state).toBe('idle');
  });

  it('captures permission action while waiting', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, {
      type: 'permission/request',
      requestId: 'p1',
      action: 'bash',
      detail: 'rm -rf',
      defaultDecision: 'ask',
    });
    expect(ctx.permissionAction).toBe('bash');
    ctx = reducePetAgentContext(ctx, {
      type: 'permission/resolved',
      requestId: 'p1',
      decision: 'allow',
    });
    expect(ctx.permissionAction).toBeNull();
  });

  it('tracks run phase from run/phase events', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, {
      type: 'run/phase',
      sessionId: 's1',
      runId: 'r1',
      phase: 'preparing',
      at: '2026-01-01T00:00:00Z',
    });
    expect(ctx.runPhase).toBe('preparing');
    ctx = reducePetAgentContext(ctx, {
      type: 'run/phase',
      sessionId: 's1',
      runId: 'r1',
      phase: 'tool-running',
      at: '2026-01-01T00:00:01Z',
    });
    expect(ctx.runPhase).toBe('tool-running');
  });

  it('resets all activity fields on session/ended', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, {
      type: 'tool/start',
      toolCallId: 't1',
      toolName: 'shell',
    });
    ctx = reducePetAgentContext(ctx, {
      type: 'run/phase',
      sessionId: 's1',
      runId: 'r1',
      phase: 'streaming',
      at: '2026-01-01T00:00:00Z',
    });
    ctx = reducePetAgentContext(ctx, { type: 'session/ended', sessionId: 's1' });
    expect(ctx.activeToolName).toBeNull();
    expect(ctx.permissionAction).toBeNull();
    expect(ctx.runPhase).toBeNull();
    expect(ctx.activeTools).toBe(0);
  });
});

describe('petStateFromChatFlags', () => {
  it('prioritizes error over streaming', () => {
    expect(
      petStateFromChatFlags({
        streaming: true,
        toolRunning: true,
        hasError: true,
        waitingPermission: false,
      }),
    ).toBe('failed');
  });
});
