import type { Component } from '@earendil-works/pi-tui';
import type { HostCommand, HostResponse, SubagentResultSummary } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { TuiSubagentController } from './tui-subagent-controller.js';

const ENTER = '\r';
const DOWN = '\x1b[B';
const allow = { allowed: true };

const RESULT = {
  resultId: 'r1',
  revision: 3,
  parentSessionId: 'parent',
  childSessionId: 'child-1',
  integrationStatus: 'pending',
  reviewStatus: 'approved',
  executionStatus: 'completed',
  summaryStatus: 'merged',
  childChanges: { changeSetId: 'cs', revision: 1 },
  appliedChanges: null,
  candidateGeneration: null,
  availability: { view: allow, apply: allow, resolve: { allowed: false }, cleanup: allow },
} as unknown as SubagentResultSummary;

/** Shows one overlay at a time and lets the test press keys on it. */
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

function setup(options: { embedded?: boolean } = {}) {
  const commands: HostCommand[] = [];
  const reply = (command: HostCommand, data: unknown): HostResponse => ({
    type: 'response',
    command: command.type,
    success: true,
    data,
  });
  const request = async (command: HostCommand): Promise<HostResponse> => {
    commands.push(command);
    switch (command.type) {
      case 'session/list-children':
        return reply(command, { sessions: [{ id: 'child-1', name: '重构存储', subagentStatus: 'done' }] });
      case 'subagent/results':
        return reply(command, { items: [RESULT] });
      case 'subagent/result-files':
        return reply(command, { files: [{ fileId: 'f1', relativePath: 'src/store.ts', kind: 'modified' }] });
      case 'subagent/result-diff':
        return reply(command, { additions: 1, deletions: 1, binary: false, patch: '@@ -1 +1 @@\n-old\n+new' });
      case 'subagent/cleanup-plan':
        return reply(command, { token: 'cleanup-token', expiresAt: '' });
      default:
        return reply(command, {});
    }
  };
  const modals = new FakeModals();
  const port = {
    onChanged: vi.fn(),
    onHint: vi.fn(),
    onNotice: vi.fn(),
    onError: vi.fn(),
    openSession: vi.fn(async () => undefined),
  };
  const controller = new TuiSubagentController({
    link: { request } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
    embedded: options.embedded ?? false,
    getSessionId: () => 'parent',
    ...port,
  });
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const sent = (type: HostCommand['type']): HostCommand[] => commands.filter((command) => command.type === type);
  return { controller, modals, port, commands, sent, settle };
}

describe('TuiSubagentController', () => {
  it('loads children and results and reports what needs a decision', async () => {
    const { controller, sent } = setup();
    expect(controller.describe()).toBeUndefined();
    await controller.load('parent');
    expect(controller.describe()).toBe('1 个结果待处理');
    expect(sent('session/list-children')).toEqual([{ type: 'session/list-children', parentSessionId: 'parent' }]);
  });

  it('follows pushes: announces a child ending and replaces an updated result', async () => {
    const { controller, port } = setup();
    await controller.load('parent');
    controller.handlePush({
      type: 'subagent/updated',
      parentSessionId: 'parent',
      child: { id: 'child-2', name: '写测试', subagentStatus: 'running' },
    } as never);
    expect(controller.describe()).toBe('子代理 1 运行中 · 1 个结果待处理');
    controller.handlePush({
      type: 'subagent/updated',
      parentSessionId: 'parent',
      child: { id: 'child-2', name: '写测试', subagentStatus: 'failed' },
    } as never);
    expect(port.onNotice).toHaveBeenCalledWith('error', '子代理「写测试」失败 · /subagents 查看');
    controller.handlePush({
      type: 'subagent/result-updated',
      parentSessionId: 'parent',
      result: { ...RESULT, integrationStatus: 'applied' },
    } as never);
    expect(controller.describe()).toBeUndefined();
  });

  it('ignores pushes about another session’s children but still claims them', async () => {
    const { controller } = setup();
    await controller.load('parent');
    const claimed = controller.handlePush({
      type: 'subagent/updated',
      parentSessionId: 'elsewhere',
      child: { id: 'x', subagentStatus: 'running' },
    } as never);
    expect(claimed).toBe(true);
    expect(controller.describe()).toBe('1 个结果待处理');
  });

  it('walks from the child to a file diff and back to the file list', async () => {
    const { controller, modals, settle } = setup();
    await controller.load('parent');
    controller.open();
    expect(modals.text()).toContain('重构存储');
    modals.press(ENTER);
    expect(modals.text()).toContain('查看改动的文件');
    modals.press(ENTER);
    await settle();
    expect(modals.text()).toContain('src/store.ts');
    modals.press(ENTER);
    await settle();
    expect(modals.text()).toContain('+new');
    modals.press('q');
    await settle();
    expect(modals.text()).toContain('改动的文件');
  });

  it('applies a result at the revision it showed', async () => {
    const { controller, modals, sent, port, settle } = setup();
    await controller.load('parent');
    controller.open();
    modals.press(ENTER, DOWN, ENTER);
    await settle();
    expect(sent('subagent/worktree-action')).toEqual([
      { type: 'subagent/worktree-action', action: 'apply', resultId: 'r1', expectedRevision: 3 },
    ]);
    expect(port.onNotice).toHaveBeenCalledWith('info', '子代理的改动已应用到工作区');
  });

  it('discards only after a cleanup plan and an explicit confirmation', async () => {
    const { controller, modals, sent, settle } = setup();
    await controller.load('parent');
    controller.open();
    // files, apply, retain, discard
    modals.press(ENTER, DOWN, DOWN, DOWN, ENTER);
    await settle();
    expect(sent('subagent/cleanup-plan')).toHaveLength(1);
    expect(sent('subagent/worktree-action')).toEqual([]);
    expect(modals.text()).toContain('不丢弃');
    modals.press(DOWN, ENTER);
    await settle();
    expect(sent('subagent/worktree-action')).toEqual([
      {
        type: 'subagent/worktree-action',
        action: 'discard',
        resultId: 'r1',
        expectedRevision: 3,
        cleanupToken: 'cleanup-token',
      },
    ]);
  });

  it('sends a follow-up to a finished child', async () => {
    const { controller, modals, sent, port, settle } = setup();
    await controller.load('parent');
    controller.open();
    // files, apply, retain, discard, continue
    modals.press(ENTER, DOWN, DOWN, DOWN, DOWN, ENTER);
    expect(modals.text()).toContain('给子代理追加指令');
    for (const character of '补上测试') modals.press(character);
    modals.press(ENTER);
    await settle();
    expect(sent('subagent/continue')).toEqual([
      { type: 'subagent/continue', childSessionId: 'child-1', text: '补上测试' },
    ]);
    expect(port.onHint).toHaveBeenCalledWith('已发给子代理');
  });

  it('announces a follow-up ending once, even if it settles straight to done', async () => {
    const { controller, modals, port, settle } = setup();
    await controller.load('parent');
    const doneAgain = {
      type: 'subagent/updated',
      parentSessionId: 'parent',
      child: { id: 'child-1', name: '重构存储', subagentStatus: 'done' },
    } as never;
    controller.handlePush(doneAgain);
    expect(port.onNotice).not.toHaveBeenCalled();
    controller.open();
    modals.press(ENTER, DOWN, DOWN, DOWN, DOWN, ENTER);
    for (const character of '补上测试') modals.press(character);
    modals.press(ENTER);
    await settle();
    controller.handlePush(doneAgain);
    expect(port.onNotice).toHaveBeenCalledWith('info', '子代理「重构存储」已完成 · /subagents 查看');
    controller.handlePush(doneAgain);
    expect(port.onNotice).toHaveBeenCalledTimes(1);
  });

  it('does not offer to open a child conversation when embedded', async () => {
    const { controller, modals } = setup({ embedded: true });
    await controller.load('parent');
    controller.open();
    modals.press(ENTER);
    expect(modals.text()).not.toContain('打开子代理的对话');
  });
});
