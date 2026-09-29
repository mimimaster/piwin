// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import { ChatTurnFilesSummary } from '../chat-turn-files-summary';
import { TurnChangeBar } from './turn-change-bar';
import {
  TurnChangesProvider,
  type TurnChangeActionResult,
  type TurnChangesApi,
} from './turn-changes-context';
import { EMPTY_TURN_CHANGE_INDEX } from './turn-change-index';

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
} {
  return {
    index: EMPTY_TURN_CHANGE_INDEX,
    ensureRuns: vi.fn(),
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
    expect(q('turn-change-bar-title')?.textContent).toBe('本轮修改 2 个文件');
    expect(q('turn-change-bar-stat')?.textContent).toBe('+5−1');
    await act(async () => q('turn-change-bar-undo')?.click());
    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({ changeSetId: 'cs-1' }), 'undo');
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
    expect(q('turn-change-bar-title')?.textContent).toBe('本轮已撤销 · 原修改 2 个文件');
    expect(q('turn-change-bar-undo')).toBeNull();
    expect(q('turn-change-bar-redo')?.textContent).toBe('恢复改动');
  });

  it('explains a conflict, changes nothing, and can check again', async () => {
    const api = fakeApi({ kind: 'conflict', affectedPaths: ['src/a.ts'] });
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-undo')?.click());
    await flush();
    expect(q('turn-change-bar-conflict')?.textContent).toContain('1 个文件在本轮结束后又被修改');
    expect(q('turn-change-bar-conflict')?.textContent).toContain('src/a.ts');
    await act(async () => q('turn-change-bar-recheck')?.click());
    await flush();
    expect(api.check).toHaveBeenCalledWith(expect.anything(), 'undo');
    expect(q('turn-change-bar-conflict')).toBeNull();
  });

  it('says why an incomplete record cannot be undone and lists command-changed files', async () => {
    await render(
      <TurnChangeBar
        summary={summary({
          captureState: 'incomplete',
          coverageComplete: false,
          incompleteReason: 'command-overlap',
          undo: { allowed: false, reason: 'capture-incomplete' },
          excludedPaths: ['dist/out.js'],
        })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-undo')).toBeNull();
    expect(q('turn-change-bar-incomplete')?.textContent).toContain('有命令也修改了本轮改过的文件');
    expect(q('turn-change-bar-excluded')?.textContent).toContain('dist/out.js');
  });

  it('shows recording while the turn is still being sealed', async () => {
    await render(
      <TurnChangeBar
        summary={summary({ captureState: 'collecting', undo: { allowed: false, reason: 'capture-pending' } })}
        api={fakeApi()}
      />,
    );
    expect(q('turn-change-bar-title')?.textContent).toBe('正在记录本轮改动…');
    expect(q('turn-change-bar-undo')).toBeNull();
  });

  it("opens the turn's own diff per file", async () => {
    const api = fakeApi();
    await render(<TurnChangeBar summary={summary()} api={api} />);
    await act(async () => q('turn-change-bar-view')?.click());
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
    expect(container.querySelector('[data-testid="turn-change-bar-title"]')?.textContent).toBe(
      '本轮已撤销 · 原修改 2 个文件',
    );
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
});
