import type { Component } from '@earendil-works/pi-tui';
import type { HostCommand, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent, type TranscriptState } from './transcript-model.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { TuiTurnChangeController } from './tui-turn-change-controller.js';

const ENTER = '\r';
const DOWN = '\x1b[B';

function summary(patch: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'a',
    sessionId: 's1',
    workspaceId: 'w',
    userMessageId: 'u1',
    runIds: ['run-1'],
    revision: 4,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 1,
    additions: 2,
    deletions: 1,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    ...patch,
  };
}

function transcriptWithRun(): TranscriptState {
  const state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', '加一个登录页');
  return applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
}

class FakeModals {
  public current: (Component & { handleInput?: (data: string) => void }) | undefined;
  public show(component: Component): void {
    this.current = component;
  }
  public close(): void {
    this.current = undefined;
  }
  public press(...keys: string[]): void {
    for (const key of keys) this.current?.handleInput?.(key);
  }
  public text(): string {
    return (this.current?.render(80) ?? []).join('\n');
  }
}

function setup(options: { listed?: TurnChangeSummary[]; undoError?: string; running?: boolean; transcript?: TranscriptState } = {}) {
  const commands: HostCommand[] = [];
  let listed = options.listed ?? [summary()];
  const reply = (command: HostCommand, data: unknown): HostResponse => ({
    type: 'response',
    command: command.type,
    success: true,
    data,
  });
  const request = async (command: HostCommand): Promise<HostResponse> => {
    commands.push(command);
    switch (command.type) {
      case 'turn-changes/list-by-runs':
        return reply(command, { summaries: listed });
      case 'turn-changes/files':
        return reply(command, {
          files: [{ fileId: 'f1', relativePath: 'src/login.ts', kind: 'added', additions: 2, deletions: 0, binary: false }],
          nextCursor: null,
        });
      case 'turn-changes/diff':
        return reply(command, { relativePath: 'src/login.ts', additions: 2, deletions: 0, binary: false, patch: '@@\n+a\n+b' });
      case 'turn-changes/undo':
        if (options.undoError !== undefined) {
          return { type: 'response', command: command.type, success: false, error: options.undoError };
        }
        // The Host flips the turn; the next listing reflects it.
        listed = listed.map((entry) => ({ ...entry, disposition: 'undone', redo: { allowed: true } }));
        return reply(command, {});
      case 'turn-changes/operation':
        return reply(command, { operationId: 'op-1', revision: 3, status: 'needs-repair' });
      case 'turn-changes/recovery-preview':
        return reply(command, {
          files: [{ relativePath: 'src/login.ts', state: 'operation-content' }],
          confirmationToken: 'repair-token',
        });
      case 'turn-changes/recovery-verify':
        return reply(command, { verified: true, files: [] });
      default:
        return reply(command, {});
    }
  };
  const modals = new FakeModals();
  const port = { onHint: vi.fn(), onNotice: vi.fn(), onError: vi.fn() };
  const controller = new TuiTurnChangeController({
    link: { request } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
    getSessionId: () => 's1',
    getTranscript: () => options.transcript ?? transcriptWithRun(),
    isRunning: () => options.running ?? false,
    ...port,
  });
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const sent = (type: HostCommand['type']): HostCommand[] => commands.filter((command) => command.type === type);
  return { controller, modals, port, sent, settle };
}

describe('TuiTurnChangeController', () => {
  it('asks the Host about the runs on screen and lists the turns that changed files', async () => {
    const { controller, modals, sent } = setup();
    await controller.open();
    expect(sent('turn-changes/list-by-runs')).toEqual([
      { type: 'turn-changes/list-by-runs', sessionId: 's1', runIds: ['run-1'] },
    ]);
    expect(modals.text()).toContain('加一个登录页');
    expect(modals.text()).toContain('1 个文件 +2 −1');
  });

  it('says so when nothing on screen changed files, without asking about no runs', async () => {
    const { controller, port, sent } = setup({ transcript: EMPTY_TRANSCRIPT });
    await controller.open();
    expect(sent('turn-changes/list-by-runs')).toEqual([]);
    expect(port.onHint).toHaveBeenCalledWith('当前这页对话里没有改动文件的回合');
  });

  it('shows a turn’s files and a file’s diff', async () => {
    const { controller, modals, settle } = setup();
    await controller.open();
    modals.press(ENTER, ENTER);
    await settle();
    expect(modals.text()).toContain('src/login.ts');
    modals.press(ENTER);
    await settle();
    expect(modals.text()).toContain('+a');
  });

  it('undoes the latest turn only after confirmation, at the revision shown, and reports it', async () => {
    const { controller, modals, sent, port, settle } = setup();
    await controller.undoLatest();
    expect(modals.text()).toContain('改回这一轮开始前的样子');
    expect(sent('turn-changes/undo')).toEqual([]);
    modals.press(DOWN, ENTER);
    await settle();
    expect(sent('turn-changes/undo')).toEqual([
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 4 },
    ]);
    expect(port.onNotice).toHaveBeenCalledWith('info', '已撤销 1 个文件的改动');
  });

  it('cancelling the confirmation changes nothing', async () => {
    const { controller, modals, sent, settle } = setup();
    await controller.undoLatest();
    modals.press(ENTER);
    await settle();
    expect(sent('turn-changes/undo')).toEqual([]);
  });

  it('explains instead of asking when the Host already rules the undo out', async () => {
    const blocked = summary({ undo: { allowed: false, reason: 'files-changed', affectedPaths: ['src/login.ts'] } });
    const { controller, modals, port } = setup({ listed: [blocked] });
    await controller.undoLatest();
    expect(modals.current).toBeUndefined();
    expect(port.onNotice).toHaveBeenCalledWith('error', '上一轮的改动不能撤销 — 这些文件之后又被改过：src/login.ts');
  });

  it('puts a late refusal into words', async () => {
    const { controller, modals, port, settle } = setup({ undoError: 'workspace-busy' });
    await controller.undoLatest();
    modals.press(DOWN, ENTER);
    await settle();
    expect(port.onNotice).toHaveBeenCalledWith('error', '撤销没有执行 — 工作区正忙');
  });

  it('refuses to touch files while a turn is running', async () => {
    const { controller, modals, port } = setup({ running: true });
    await controller.undoLatest();
    expect(modals.current).toBeUndefined();
    expect(port.onHint).toHaveBeenCalledWith('运行中不能改动文件，先按 Esc 中断');
  });

  it('repairs a half-finished operation with the token of the preview it showed', async () => {
    const stuck = summary({ latestOperationId: 'op-1', undo: { allowed: false, reason: 'needs-repair' } });
    const { controller, modals, sent, port, settle } = setup({ listed: [stuck] });
    await controller.open();
    // pick the turn, then: files, repair
    modals.press(ENTER, DOWN, ENTER);
    await settle();
    expect(modals.text()).toContain('src/login.ts — 会放回操作前的样子');
    expect(sent('turn-changes/recovery-run')).toEqual([]);
    modals.press(DOWN, ENTER);
    await settle();
    expect(sent('turn-changes/recovery-run')).toEqual([
      { type: 'turn-changes/recovery-run', operationId: 'op-1', expectedRevision: 3, confirmationToken: 'repair-token' },
    ]);
    expect(port.onNotice).toHaveBeenCalledWith('info', '已修复，这一轮可以重新撤销或恢复');
  });

  it('announces an undo made from another shell', async () => {
    const { controller, port } = setup();
    await controller.open();
    controller.handlePush({
      type: 'turn-changes/updated',
      workspaceId: 'w',
      changeSetId: 'cs-1',
      revision: 5,
      summary: summary({ disposition: 'undone', revision: 5 }),
    });
    expect(port.onNotice).toHaveBeenCalledWith('info', '已撤销 1 个文件的改动');
  });
});
