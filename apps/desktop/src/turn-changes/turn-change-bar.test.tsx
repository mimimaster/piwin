// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import { ChatTurnFilesSummary } from '../chat-turn-files-summary';
import { TurnChangeBar } from './turn-change-bar';
import { TurnChangePanel } from './turn-change-panel';
import {
  TurnChangesProvider,
  type TurnChangeActionResult,
  type TurnChangesApi,
} from './turn-changes-context';
import { EMPTY_TURN_CHANGE_INDEX } from './turn-change-index';
import type { TurnChangeGestureEvent } from './turn-change-gesture';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function summary(overrides: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'at-1',
    sessionId: 'session-1',
    workspaceId: 'ws',
    userMessageId: null,
    runIds: ['run-1'],
    revision: 1,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 2,
    additions: 5,
    deletions: 1,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    incompleteReason: null,
    excludedPaths: [],
    ...overrides,
  };
}

function fakeApi(result: TurnChangeActionResult = { kind: 'done' }): TurnChangesApi & {
  run: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  diff: ReturnType<typeof vi.fn>;
  showConflict: ReturnType<typeof vi.fn>;
  revealChangeSet: ReturnType<typeof vi.fn>;
  focusChangeSet: ReturnType<typeof vi.fn>;
} {
  return {
    index: EMPTY_TURN_CHANGE_INDEX,
    ensureRuns: vi.fn(),
    focusedChangeSetId: null,
    focusRequest: 0,
    focusChangeSet: vi.fn(),
    live: new Map(),
    cancel: vi.fn(async () => 'cancelled' as const),
    conflicts: new Map(),
    showConflict: vi.fn(),
    revealChangeSet: vi.fn(() => true),
    run: vi.fn(async () => result),
    check: vi.fn(async () => ({
      changeSetId: 'cs-1',
      revision: 1,
      direction: 'undo' as const,
      availability: { allowed: true as const },
    })),
    files: vi.fn(async () => [
      { fileId: 'f1', relativePath: 'src/a.ts', kind: 'modified' as const, additions: 1, deletions: 1, binary: false },
    ]),
    diff: vi.fn(async () => ({
      fileId: 'f1',
      relativePath: 'src/a.ts',
      kind: 'modified' as const,
      additions: 1,
      deletions: 1,
      binary: false,
      changeSetId: 'cs-1',
      revision: 1,
      patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
    })),
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const q = (id: string): HTMLElement | null => container.querySelector(`[data-testid="${id}"]`);

describe('TurnChangeBar', () => {
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

  it('shows the recorded counts and undoes with one click', async () => {
    const api = fakeApi();
    await render(<TurnChangeBar summary={summary()} api={api} />);
    expect(q('turn-change-bar-title')?.textContent).toBe('本轮改动');
    expect(q('turn-change-bar-meta')?.textContent).toBe('2 个文件');
    expect(q('turn-change-bar-stat')?.textContent).toBe('+5−1');
    expect(q('turn-change-bar-undo')?.textContent).toBe('撤销');
    await act(async () => q('turn-change-bar-undo')?.click());
    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({ changeSetId: 'cs-1' }), 'undo', expect.any(Function));
  });

  it('shows progress while running and cancels before the first write', async () => {
    let finish: (result: TurnChangeActionResult) => void = () => undefined;
    const api = fakeApi();
    api.run.mockImplementation(() => new Promise<TurnChangeActionResult>((resolve) => (finish = resolve)));
    const rendered = { rerender: render };
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    expect(q('turn-change-bar-running-text')?.textContent).toBe('正在撤销…');
    // The Host announced the operation; nothing written yet → 取消 is offered.
    api.live = new Map([['cs-1', { operationId: 'op-1', progress: null }]]);
    await rendered.rerender(<TurnChangeBar summary={summary()} api={{ ...api }} />);
    await act(async () => q('turn-change-bar-cancel')?.click());
    await flush();
    expect(api.cancel).toHaveBeenCalledWith('op-1');
    expect(q('turn-change-bar-running-text')?.textContent).toBe('正在取消…');
    await act(async () => finish({ kind: 'not-applied', reason: 'cancelled' }));
    await flush();
    expect(q('turn-change-bar-error')?.textContent).toContain('已取消，文件未改变');
  });

  it('shows N / M files and hides cancel once writing started', async () => {
    const api = fakeApi();
    api.run.mockImplementation(() => new Promise<TurnChangeActionResult>(() => undefined));
    const rendered = { rerender: render };
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    api.live = new Map([['cs-1', { operationId: 'op-1', progress: { done: 1, total: 2 } }]]);
    await rendered.rerender(<TurnChangeBar summary={summary()} api={{ ...api }} />);
    expect(q('turn-change-bar-running-text')?.textContent).toBe('正在撤销 1 / 2 个文件…');
    expect(q('turn-change-bar-cancel')).toBeNull();
  });

  it('says the result is unconfirmed while reconnecting, then shows the real result', async () => {
    let emit: (event: TurnChangeGestureEvent) => void = () => undefined;
    let finish: (result: TurnChangeActionResult) => void = () => undefined;
    const api = fakeApi();
    api.run.mockImplementation(
      (_summary: unknown, _direction: unknown, onEvent: (event: TurnChangeGestureEvent) => void) => {
        emit = onEvent;
        return new Promise<TurnChangeActionResult>((resolve) => (finish = resolve));
      },
    );
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    await act(async () => emit({ kind: 'reconnecting' }));
    expect(q('turn-change-bar-running-text')?.textContent).toBe('结果尚未确认，正在重连…');
    expect(q('turn-change-bar-cancel')).toBeNull();
    await act(async () => finish({ kind: 'done' }));
    await flush();
    expect(q('turn-change-bar-running')).toBeNull();
    expect(q('turn-change-bar-error')).toBeNull();
  });

  it('lists the files without a click and fetches them once per revision', async () => {
    const api = fakeApi();
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await flush();
    expect(container.querySelectorAll('[data-testid="turn-change-bar-file"]')).toHaveLength(1);
    await render(<TurnChangeBar summary={summary({ disposition: 'undone' })} api={api} />);
    await flush();
    expect(api.files).toHaveBeenCalledTimes(1);
  });

  it('folds rows past the first three behind a toggle', async () => {
    const api = fakeApi();
    api.files = vi.fn(async () =>
      ['a', 'b', 'c', 'd', 'e'].map((name) => ({
        fileId: name,
        relativePath: `src/${name}.ts`,
        kind: 'modified' as const,
        additions: 1,
        deletions: 0,
        binary: false,
      })),
    );
    await render(<TurnChangeBar summary={summary({ fileCount: 5 })} api={api} />);
    await flush();
    expect(container.querySelectorAll('[data-testid="turn-change-bar-file"]')).toHaveLength(3);
    expect(q('turn-change-bar-more')?.textContent).toBe('还有 2 个文件');
    await act(async () => q('turn-change-bar-more')?.click());
    expect(container.querySelectorAll('[data-testid="turn-change-bar-file"]')).toHaveLength(5);
  });

  it('offers restore once undone', async () => {
    await render(
      <TurnChangeBar
        summary={summary({
          disposition: 'undone',
          undo: { allowed: false, reason: 'direction-unavailable' },
          redo: { allowed: true },
        })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-title')?.textContent).toBe('本轮已撤销');
    expect(q('turn-change-bar-meta')?.textContent).toBe('原修改 2 个文件');
    expect(q('turn-change-bar')?.dataset.state).toBe('undone');
    expect(q('turn-change-bar-undo')).toBeNull();
    expect(q('turn-change-bar-redo')?.textContent).toBe('恢复改动');
  });

  it('explains a conflict, changes nothing, and can check again', async () => {
    const api = fakeApi({ kind: 'conflict', reason: 'files-changed', affectedPaths: ['src/a.ts'], conflicts: [] });
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    await flush();
    expect(q('turn-change-bar-conflict')?.textContent).toContain('1 个文件在本轮结束后又被修改');
    expect(q('turn-change-bar-conflict')?.getAttribute('role')).toBe('alert');
    expect(q('turn-change-bar-conflict')?.querySelector('.turn-change-bar-chip')?.textContent).toBe('src/a.ts');
    expect(q('turn-change-bar')?.dataset.state).toBe('conflict');
    // Retrying would fail the same way; only 重新检查 brings undo back.
    expect(q('turn-change-bar-undo')).toBeNull();
    await act(async () => q('turn-change-bar-recheck')?.click());
    await flush();
    expect(api.check).toHaveBeenCalledWith(expect.anything(), 'undo');
    expect(q('turn-change-bar-conflict')).toBeNull();
  });

  it('opens 查看冲突 with each path’s later turn or unknown source', async () => {
    const conflicts = [
      { relativePath: 'src/a.ts', laterTurns: [{ changeSetId: 'cs-9', sessionId: 'session-1', runIds: ['r9'], endedAt: null }] },
    ];
    const api = fakeApi({ kind: 'conflict', reason: 'files-changed', affectedPaths: ['src/a.ts'], conflicts });
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    await flush();
    await act(async () => q('turn-change-bar-view-conflict')?.click());
    expect(api.showConflict).toHaveBeenCalledWith('cs-1', { direction: 'undo', reason: 'files-changed', conflicts });

    // The panel shows the list: source, 定位到后续轮次, and the current-file diff.
    api.conflicts = new Map([['cs-1', { direction: 'undo', reason: 'files-changed', conflicts }]]);
    await render(<TurnChangeBar summary={summary()} api={{ ...api }} placement="panel" />);
    await flush();
    expect(q('turn-change-conflicts')).not.toBeNull();
    expect(q('turn-change-conflict-source')?.textContent).toContain('本对话后续一轮修改了它');
    await act(async () => q('turn-change-conflict-reveal')?.click());
    expect(api.revealChangeSet).toHaveBeenCalledWith('cs-9');
    await act(async () => q('turn-change-conflict-current')?.click());
    await flush();
    expect(api.diff).toHaveBeenCalledWith(expect.objectContaining({ changeSetId: 'cs-1' }), 'f1', 'current');
    await act(async () => q('turn-change-conflicts-close')?.click());
    expect(api.showConflict).toHaveBeenLastCalledWith('cs-1', null);
  });

  it('says 来源未知 when no recorded turn changed the path', async () => {
    const api = fakeApi();
    api.conflicts = new Map([
      ['cs-1', { direction: 'undo', reason: 'files-changed', conflicts: [{ relativePath: 'src/a.ts', laterTurns: [] }] }],
    ]);
    await render(<TurnChangeBar summary={summary()} api={api} placement="panel" />);
    await flush();
    expect(q('turn-change-conflict-source')?.textContent).toContain('来源未知');
    expect(q('turn-change-conflict-reveal')).toBeNull();
  });

  it.each([
    ['staged-paths', '有已暂存或未解决的冲突', '本次未修改任何文件'],
    ['backup-failed', '撤销数据不可用', '文件未改变'],
    ['permission-denied', 'Host 没有权限读写', '文件未改变'],
  ] as const)('explains a %s refusal and changes nothing', async (reason, text, untouched) => {
    const api = fakeApi({ kind: 'conflict', reason, affectedPaths: ['src/a.ts'], conflicts: [] });
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    await flush();
    expect(q('turn-change-bar-conflict')?.textContent).toContain(text);
    expect(q('turn-change-bar-conflict')?.textContent).toContain(untouched);
  });

  it('says why an incomplete record cannot be undone and names the files that block it', async () => {
    await render(
      <TurnChangeBar
        summary={summary({
          captureState: 'incomplete',
          coverageComplete: false,
          incompleteReason: 'command-overlap',
          undo: { allowed: false, reason: 'capture-incomplete' },
          overlappingPaths: ['src/a.ts'],
          excludedPaths: ['dist/out.js', 'dist/out.css'],
        })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-undo')).toBeNull();
    expect(q('turn-change-bar-locked')?.textContent).toBe('不可撤销');
    const note = q('turn-change-bar-incomplete');
    expect(note?.textContent).toContain('有命令也修改了本轮改过的文件');
    // The files that block undo are the ones named.
    expect(q('turn-change-bar-overlapping')?.textContent).toContain('src/a.ts');
    // The others are a count only: no scope wording, no path list on the card.
    expect(q('turn-change-bar-excluded')?.textContent).toBe('另有 2 个文件由命令修改');
    expect(note?.textContent).not.toContain('不在撤销范围');
    expect(note?.textContent).not.toContain('dist/out.js');
    // One footer: the paths sit inside the incomplete note.
    expect(container.querySelectorAll('.turn-change-bar-foot')).toHaveLength(1);
  });

  it('lists every command-changed file of an incomplete turn in the side panel', async () => {
    await render(
      <TurnChangeBar
        placement="panel"
        summary={summary({
          captureState: 'incomplete',
          coverageComplete: false,
          incompleteReason: 'command-overlap',
          undo: { allowed: false, reason: 'capture-incomplete' },
          overlappingPaths: ['src/a.ts'],
          excludedPaths: ['dist/out.js', 'dist/out.css'],
        })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-excluded')?.textContent).toContain('另有 2 个文件由命令修改');
    expect(q('turn-change-bar-excluded')?.textContent).toContain('dist/out.js');
    expect(q('turn-change-bar-excluded')?.textContent).toContain('dist/out.css');
  });

  it('folds a long overlap list behind a toggle', async () => {
    const paths = Array.from({ length: 8 }, (_, index) => `src/file-${index}.ts`);
    await render(
      <TurnChangeBar
        summary={summary({
          captureState: 'incomplete',
          coverageComplete: false,
          incompleteReason: 'command-overlap',
          undo: { allowed: false, reason: 'capture-incomplete' },
          overlappingPaths: paths,
        })}
        api={fakeApi()}
      />,
    );
    const chips = (): number => q('turn-change-bar-overlapping')?.querySelectorAll('.turn-change-bar-chip').length ?? 0;
    expect(chips()).toBe(5);
    const toggle = q('turn-change-bar-overlapping-toggle');
    expect(toggle?.textContent).toBe('另有 3 个');
    await act(async () => toggle?.click());
    expect(chips()).toBe(8);
    expect(q('turn-change-bar-overlapping-toggle')?.textContent).toBe('收起');
  });

  it('folds command-changed files past three behind a toggle, and the panel lists them all', async () => {
    const paths = ['a.css', 'b.css', 'c.css', 'd.css', 'e.css', 'f.css'];
    await render(<TurnChangeBar summary={summary({ excludedPaths: paths })} api={fakeApi()} />);
    const chips = (): number => q('turn-change-bar-excluded')?.querySelectorAll('.turn-change-bar-chip').length ?? 0;
    expect(chips()).toBe(3);
    expect(q('turn-change-bar-excluded-paths-toggle')?.textContent).toBe('另有 3 个由命令修改');
    await act(async () => q('turn-change-bar-excluded-paths-toggle')?.click());
    expect(chips()).toBe(6);

    await render(
      <TurnChangeBar placement="panel" summary={summary({ excludedPaths: paths })} api={fakeApi()} />,
    );
    expect(chips()).toBe(6);
  });

  it('shows one hidden chip instead of a toggle that saves no room', async () => {
    await render(
      <TurnChangeBar
        summary={summary({ excludedPaths: ['a.css', 'b.css', 'c.css', 'd.css'] })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-excluded')?.querySelectorAll('.turn-change-bar-chip')).toHaveLength(4);
    expect(q('turn-change-bar-excluded-paths-toggle')).toBeNull();
  });

  it('says which command-created files an undo left in place', async () => {
    const paths = ['a.log', 'b.log', 'c.log', 'd.log', 'e.log'];
    await render(
      <TurnChangeBar
        summary={summary({
          disposition: 'undone',
          undo: { allowed: false, reason: 'direction-unavailable' },
          redo: { allowed: true },
          leftInPlacePaths: paths,
        })}
        api={fakeApi()}
      />,
    );
    const foot = q('turn-change-bar-left-in-place');
    expect(foot?.textContent).toContain('有 5 个命令新建的文件在这一轮之后又被改动，撤销没有动它们');
    expect(foot?.querySelectorAll('.turn-change-bar-chip')).toHaveLength(3);
    expect(q('turn-change-bar-left-in-place-paths-toggle')?.textContent).toBe('另有 2 个');
    // One footer, and only for an undone turn.
    expect(container.querySelectorAll('.turn-change-bar-foot')).toHaveLength(1);

    // The panel is its own mount, not the card re-rendered.
    await render(
      <TurnChangeBar
        key="panel"
        placement="panel"
        summary={summary({
          disposition: 'undone',
          undo: { allowed: false, reason: 'direction-unavailable' },
          redo: { allowed: true },
          leftInPlacePaths: paths,
        })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-left-in-place')?.querySelectorAll('.turn-change-bar-chip')).toHaveLength(5);

    await render(<TurnChangeBar summary={summary({ leftInPlacePaths: paths })} api={fakeApi()} />);
    expect(q('turn-change-bar-left-in-place')).toBeNull();
  });

  it('lists command-changed files alone when the turn wrote nothing itself', async () => {
    await render(
      <TurnChangeBar
        summary={summary({
          fileCount: 0,
          additions: 0,
          deletions: 0,
          undo: { allowed: false, reason: 'no-changes' },
          excludedPaths: ['pnpm-lock.yaml'],
        })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-title')?.textContent).toBe('命令改动');
    expect(q('turn-change-bar-undo')).toBeNull();
    expect(q('turn-change-bar-excluded')?.textContent).toContain('pnpm-lock.yaml');
  });

  it('renders nothing while the turn is still being recorded', async () => {
    const api = fakeApi();
    await render(
      <TurnChangeBar
        summary={summary({ captureState: 'collecting', undo: { allowed: false, reason: 'capture-pending' } })}
        api={api}
      />,
    );
    expect(q('turn-change-bar')).toBeNull();
    expect(api.files).not.toHaveBeenCalled();
  });

  it("opens the turn's own diff per file", async () => {
    const api = fakeApi();
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await flush();
    await act(async () => q('turn-change-bar-file')?.click());
    await flush();
    expect(api.diff).toHaveBeenCalledWith(expect.anything(), 'f1');
    expect(container.querySelector('[data-testid="diff-card"]')?.textContent).toContain('new');
  });

  it('renders nothing for a sealed turn without file changes', async () => {
    await render(
      <TurnChangeBar
        summary={summary({ fileCount: 0, additions: 0, deletions: 0, undo: { allowed: false, reason: 'no-changes' } })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar')).toBeNull();
  });
});

describe('ChatTurnFilesSummary with a Host record', () => {
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

  it('batches the lookup, prefers the record over the per-call bar, and follows pushes', async () => {
    const requests: Array<{ command: HostCommand; options?: { idempotencyKey?: string } }> = [];
    const request = vi.fn(async (command: HostCommand, options?: { idempotencyKey?: string }) => {
      requests.push({ command, ...(options ? { options } : {}) });
      if (command.type === 'turn-changes/list-by-runs') {
        return { type: 'response', command: command.type, success: true, data: { summaries: [summary()] } } as HostResponse;
      }
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { operationId: 'op-1', status: 'succeeded' },
      } as HostResponse;
    });
    let pushListener: ((push: HostPush) => void) | null = null;
    const tools = [
      { toolCallId: 't1', toolName: 'edit', status: 'done', output: '', presentation: { kind: 'filesystem', title: 'edit', changedPaths: ['src/a.ts'] } },
    ] as never;
    await render(
      <TurnChangesProvider
        request={request}
        subscribePush={(listener) => {
          pushListener = listener;
          return () => undefined;
        }}
      >
        <ChatTurnFilesSummary role="assistant" tools={tools} sessionId="session-1" turnRunKey={'run-1\nrun-2'} />
        <ChatTurnFilesSummary role="assistant" tools={tools} sessionId="session-1" turnRunKey="run-1" />
      </TurnChangesProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const lookups = requests.filter((entry) => entry.command.type === 'turn-changes/list-by-runs');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.command).toMatchObject({ sessionId: 'session-1', runIds: ['run-1', 'run-2'] });
    expect(container.querySelectorAll('[data-testid="turn-change-bar"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="files-changed-bar"]')).toBeNull();

    await act(async () => (container.querySelector('[data-testid="turn-change-bar-undo"]') as HTMLElement).click());
    const undo = requests.find((entry) => entry.command.type === 'turn-changes/undo');
    expect(undo?.options?.idempotencyKey).toEqual(expect.any(String));

    await act(async () => {
      pushListener?.({
        type: 'turn-changes/updated',
        workspaceId: 'ws',
        changeSetId: 'cs-1',
        revision: 1,
        summary: summary({
          disposition: 'undone',
          undo: { allowed: false, reason: 'direction-unavailable' },
          redo: { allowed: true },
        }),
      });
    });
    expect(container.querySelector('[data-testid="turn-change-bar-title"]')?.textContent).toBe('本轮已撤销');
  });

  it('keeps the per-call bar when the turn has no record', async () => {
    const tools = [
      { toolCallId: 't1', toolName: 'write_file', status: 'done', output: '', presentation: { kind: 'filesystem', title: 'write_file', changedPaths: ['src/a.ts'] } },
    ] as never;
    await render(
      <TurnChangesProvider
        request={async (command) => ({ type: 'response', command: command.type, success: true, data: { summaries: [] } }) as HostResponse}
        subscribePush={() => () => undefined}
      >
        <ChatTurnFilesSummary role="assistant" tools={tools} sessionId="session-1" turnRunKey="run-9" />
      </TurnChangesProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(container.querySelector('[data-testid="turn-change-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="files-changed-bar"]')).not.toBeNull();
  });

  it('says when a write failed and was rolled back, and keeps undo available', async () => {
    const api = fakeApi({ kind: 'not-applied', reason: 'write-failed' });
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    await flush();
    expect(q('turn-change-bar-error')?.textContent).toContain('已回退');
    expect(q('turn-change-bar-undo')).not.toBeNull();
  });

  it('points a stuck operation to the undo record and offers no action', async () => {
    const api = fakeApi();
    await render(
      <TurnChangeBar
        summary={summary({
          undo: { allowed: false, reason: 'needs-repair' },
          redo: { allowed: false, reason: 'needs-repair' },
        })}
        api={api}
      />,
    );
    expect(q('turn-change-bar-needs-repair')?.textContent).toContain('代码撤销记录');
    expect(q('turn-change-bar-undo')).toBeNull();
    expect(q('turn-change-bar-redo')).toBeNull();
  });

  it('查看变更 focuses the turn for the side panel; the panel copy has no such link', async () => {
    const api = fakeApi();
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-open')?.click());
    expect(api.focusChangeSet).toHaveBeenCalledWith('cs-1');
    await render(<TurnChangeBar summary={summary()} api={api} placement="panel" />);
    expect(q('turn-change-bar-open')).toBeNull();
  });
});

describe('TurnChangePanel', () => {
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

  it('shows a hint until a card opens a turn, then that turn and its files', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'turn-changes/list-by-runs') {
        return { type: 'response', command: command.type, success: true, data: { summaries: [summary()] } };
      }
      if (command.type === 'turn-changes/files') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            changeSetId: 'cs-1',
            revision: 1,
            nextCursor: null,
            files: [{ fileId: 'f1', relativePath: 'src/a.ts', kind: 'modified', additions: 1, deletions: 1, binary: false }],
          },
        };
      }
      return { type: 'response', command: command.type, success: false, error: 'unexpected' };
    });
    const onFocus = vi.fn();
    const onWorkspace = vi.fn();
    const tools = [
      { toolCallId: 't1', toolName: 'edit', status: 'done', output: '', presentation: { kind: 'filesystem', title: 'edit', changedPaths: ['src/a.ts'] } },
    ] as never;
    await render(
      <TurnChangesProvider request={request} subscribePush={() => () => undefined} onFocusChangeSet={onFocus}>
        <ChatTurnFilesSummary role="assistant" tools={tools} sessionId="session-1" turnRunKey="run-1" />
        <TurnChangePanel projectPath={null} locale="zh-CN" onShowWorkspaceChanges={onWorkspace} />
      </TurnChangesProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(q('turn-change-panel-empty')).not.toBeNull();

    await act(async () => q('turn-change-bar-open')?.click());
    await flush();
    expect(onFocus).toHaveBeenCalledWith('cs-1');
    expect(q('turn-change-panel-empty')).toBeNull();
    const panel = q('turn-change-panel');
    expect(panel?.querySelector('[data-testid="turn-change-bar"]')).not.toBeNull();
    expect(panel?.querySelectorAll('[data-testid="turn-change-bar-file"]')).toHaveLength(1);

    await act(async () => q('turn-change-panel-workspace')?.click());
    expect(onWorkspace).toHaveBeenCalledTimes(1);
  });
});
