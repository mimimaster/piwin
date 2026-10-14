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
    // Assertions read the words, not the colours.
    return (this.current?.render(80) ?? []).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  }
}

function setup() {
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
      case 'session/messages':
        return reply(command, {
          messages: [
            { id: 'm0', role: 'user', text: 'task prompt', createdAt: '', status: 'done' },
            {
              id: 'm1',
              role: 'assistant',
              text: 'complete\n存储层拆成两层',
              createdAt: '',
              status: 'done',
              tools: [
                {
                  toolCallId: 't1',
                  toolName: 'read',
                  status: 'done',
                  output: 'body that must not show',
                  presentation: { kind: 'filesystem', title: 'Read', targetPaths: ['src/store.ts'], countTag: '80 行' },
                },
              ],
            },
          ],
        });
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
    askChildPermission: vi.fn(),
    dropPermission: vi.fn(),
  };
  const controller = new TuiSubagentController({
    link: { request } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
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

  it('opens a dense preview straight from the list, with no way into the child session', async () => {
    const { controller, modals, sent, settle } = setup();
    await controller.load('parent');
    controller.open();
    expect(modals.text()).toContain('重构存储');
    modals.press(ENTER);
    await settle();
    const text = modals.text();
    expect(sent('session/messages')).toEqual([{ type: 'session/messages', sessionId: 'child-1' }]);
    expect(text).toContain('子代理 · 重构存储');
    expect(text).toMatch(/read\s+src\/store\.ts\s+✓ 80 行/);
    expect(text).toContain('存储层拆成两层');
    expect(text).not.toContain('body that must not show');
    expect(text).not.toContain('complete');
    expect(text).not.toContain('打开子代理的对话');
    expect(text).not.toContain('追加指令');
    // Only what the Host allows is offered (resolve is refused here).
    expect(text).toContain('a 应用 · f 改动文件 · p 先保留 · d 丢弃副本 · Esc 返回');
    modals.press('\x1b');
    expect(modals.text()).toContain('Enter 预览');
  });

  it('walks from the preview to a file diff and back to the file list', async () => {
    const { controller, modals, settle } = setup();
    await controller.load('parent');
    controller.open();
    modals.press(ENTER);
    await settle();
    modals.press('f');
    await settle();
    expect(modals.text()).toContain('src/store.ts');
    modals.press(ENTER);
    await settle();
    expect(modals.text()).toContain('+new');
    modals.press('q');
    await settle();
    expect(modals.text()).toContain('改动的文件');
    modals.press('\x1b');
    await settle();
    expect(modals.text()).toContain('子代理 · 重构存储');
  });

  it('applies a result at the revision it showed', async () => {
    const { controller, modals, sent, port, settle } = setup();
    await controller.load('parent');
    controller.open();
    modals.press(ENTER);
    await settle();
    modals.press('a');
    await settle();
    expect(sent('subagent/worktree-action')).toEqual([
      { type: 'subagent/worktree-action', action: 'apply', resultId: 'r1', expectedRevision: 3 },
    ]);
    expect(port.onNotice).toHaveBeenCalledWith('info', '子代理的改动已应用到工作区');
  });

  it('explains a refused action instead of sending it', async () => {
    const { controller, modals, sent, port, settle } = setup();
    await controller.load('parent');
    controller.open();
    modals.press(ENTER);
    await settle();
    modals.press('r');
    await settle();
    expect(sent('subagent/request-resolution')).toEqual([]);
    expect(port.onHint).toHaveBeenCalledWith('现在不能交给主会话处理');
  });

  it('discards only after a cleanup plan and an explicit confirmation', async () => {
    const { controller, modals, sent, settle } = setup();
    await controller.load('parent');
    controller.open();
    modals.press(ENTER);
    await settle();
    modals.press('d');
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

  it('shows the running step from the stream on the live row and in the open preview', async () => {
    const { controller, modals, port, settle } = setup();
    await controller.load('parent');
    controller.handlePush({
      type: 'subagent/invocation-updated',
      parentSessionId: 'parent',
      invocation: {
        id: 'i1', parentSessionId: 'parent', runId: 'b1', taskId: 't', task: '重构', revision: 1,
        parentToolCallId: 'call-1', childSessionId: 'child-1', status: 'running', activity: { kind: 'thinking' },
        createdAt: '2026-10-12T07:00:00Z', updatedAt: '2026-10-12T07:00:05Z',
      },
    } as never);
    const stream = (event: unknown) =>
      controller.handlePush({ type: 'subagent/stream', parentSessionId: 'parent', childSessionId: 'child-1', event } as never);
    stream({ type: 'message/start', messageId: 'live-1', role: 'assistant' });
    stream({
      type: 'tool/start', toolCallId: 'live-t', toolName: 'grep',
      presentation: { kind: 'filesystem', title: 'Grep', inputPreview: 'persistSession(' },
    });
    expect(controller.lookupRunByToolCall('call-1')?.step).toBe('grep persistSession(');
    expect(controller.lookupRunByToolCall('call-1')?.recentSteps).toEqual(['… grep persistSession(']);
    controller.open();
    modals.press(ENTER);
    await settle();
    expect(modals.text()).toMatch(/grep\s+persistSession\(\s+…/);
    stream({ type: 'tool/end', toolCallId: 'live-t', isError: false });
    expect(controller.lookupRunByToolCall('call-1')?.step).toBeUndefined();
    expect(port.onChanged).toHaveBeenCalled();
  });

  it('routes a child permission to the regular dialog and answers it from the preview', async () => {
    const { controller, modals, sent, port, settle } = setup();
    await controller.load('parent');
    const stream = (event: unknown) =>
      controller.handlePush({ type: 'subagent/stream', parentSessionId: 'parent', childSessionId: 'child-1', event } as never);
    stream({ type: 'permission/request', requestId: 'p1', action: 'bash', detail: 'git stash list', defaultDecision: 'ask' });
    expect(port.askChildPermission).toHaveBeenCalledWith(
      { requestId: 'p1', action: 'bash', detail: 'git stash list' },
      '子代理「重构存储」',
    );
    controller.open();
    modals.press(ENTER);
    await settle();
    expect(modals.text()).toContain('需要权限 bash');
    modals.press('s');
    await settle();
    expect(sent('permission/resolve')).toEqual([
      { type: 'permission/resolve', requestId: 'p1', decision: 'allow', rememberScope: 'session' },
    ]);
    expect(port.dropPermission).toHaveBeenCalledWith('p1');
    stream({ type: 'permission/resolved', requestId: 'p1', decision: 'allow' });
    expect(modals.text()).not.toContain('需要权限');
  });

  it('tracks live invocation activity, ignoring stale revisions and other sessions', () => {
    const { controller, port } = setup();
    const base = {
      id: 'i1', parentSessionId: 'parent', runId: 'b1', taskId: 't', task: 'x', revision: 2,
      status: 'running', activity: { kind: 'tool', toolName: 'bash' },
      createdAt: '2026-10-12T07:00:00Z', updatedAt: '2026-10-12T07:00:05Z',
    };
    expect(controller.handlePush({ type: 'subagent/invocation-updated', parentSessionId: 'parent', invocation: base } as never)).toBe(true);
    expect(controller.lookupRun('i1', 'b1')?.activity).toBe('执行工具 bash');
    expect(controller.lookupRun(undefined, 'b1')?.invocationId).toBe('i1');
    expect(controller.hasRunningInvocations()).toBe(true);
    const version = controller.liveVersion;
    controller.handlePush({ type: 'subagent/invocation-updated', parentSessionId: 'parent', invocation: { ...base, revision: 1, activity: { kind: 'thinking' } } } as never);
    expect(controller.lookupRun('i1', 'b1')?.activity).toBe('执行工具 bash');
    expect(controller.liveVersion).toBe(version);
    controller.handlePush({ type: 'subagent/invocation-updated', parentSessionId: 'other', invocation: { ...base, id: 'i9' } } as never);
    expect(controller.lookupRun('i9', 'b1')).toBeUndefined();
    controller.handlePush({ type: 'subagent/invocation-updated', parentSessionId: 'parent', invocation: { ...base, revision: 3, status: 'completed', activity: { kind: 'completed' } } } as never);
    expect(controller.hasRunningInvocations()).toBe(false);
    expect(port.onChanged).toHaveBeenCalledTimes(2);
  });
});
