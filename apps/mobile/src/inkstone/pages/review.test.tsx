// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import type { HostClient, HostClientState } from '@piwin/host-client';
import { InkstoneHostProvider, type InkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { InkstoneContext } from '../inkstone-context.js';
import { INITIAL_INKSTONE_STATE } from '../inkstone-state.js';
import { ReviewPage } from './review.js';
import { PATCH_DISPLAY_LIMIT } from './review-model.js';

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
const requests: Array<ReturnType<typeof vi.fn<(command: HostCommand) => Promise<HostResponse>>>> = [];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  for (const request of requests.splice(0)) for (const [command] of request.mock.calls) {
    expect(['subagent/results', 'subagent/result-files', 'subagent/result-diff', 'subagent/batch-status']).toContain(command.type);
  }
  vi.useRealTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});
const ok = (data: unknown): HostResponse => ({ type: 'response', command: 'read', success: true, data });
const failed = (error: string): HostResponse => ({ type: 'response', command: 'read', success: false, error });
function result(id = 'one', revision = 1, parentSessionId = 'parent') {
  return { resultId: id, revision, parentSessionId, batchRunId: `batch-${id}`, executionStatus: 'completed',
    summaryStatus: 'merged', integrationStatus: 'retained', reviewStatus: 'approved',
    latestReview: { reviewId: 'review', revision: 2 }, latestVerification: { verificationId: 'verify', revision: 3 },
    availability: { view: { allowed: true }, apply: { allowed: false, reason: 'display only' }, resolve: { allowed: true }, cleanup: { allowed: false } },
  };
}
function files(start = 1, length = 14) {
  return Array.from({ length }, (_, index) => ({ fileId: `file-${start + index}`, relativePath: `file-${start + index}.ts`, kind: 'modified' }));
}
function batch(id = 'one', revision = 1, status = 'failed', verificationRevision = 3) {
  return ok({ runId: `batch-${id}`, status: 'completed', results: [{ runId: `batch-${id}`,
    resultRef: { resultId: id, revision }, deliveryVerification: { verificationId: 'verify', revision: verificationRevision,
      parentSessionId: 'parent', result: { resultId: id, revision }, status, checks: [{ evidence: 'NEVER SHOW RAW EVIDENCE' }],
    }, reviewScope: 'NEVER SHOW SCOPE', executorLease: 'NEVER SHOW LEASE',
  }] });
}
function deferred() {
  let resolve: (response: HostResponse) => void = () => { throw new Error('not initialized'); };
  const promise = new Promise<HostResponse>((done) => { resolve = done; });
  return { promise, resolve };
}
type Handler = (command: HostCommand) => HostResponse | Promise<HostResponse> | undefined;
function makeClient(handler?: Handler, unsupported: HostCommand['type'][] = []) {
  const pushes = new Set<(push: HostPush) => void>();
  const states = new Set<(state: HostClientState) => void>();
  const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    const custom = handler?.(command);
    if (custom !== undefined) return custom;
    if (command.type === 'subagent/results') return ok({ items: [result('one', 1, command.parentSessionId), result('two', 1, command.parentSessionId)] });
    if (command.type === 'subagent/result-files') return ok({ files: files() });
    if (command.type === 'subagent/result-diff') return ok({ additions: 1, deletions: 1, binary: false, patch: `@@ -1 +1 @@\n-old\n+${command.fileId} PATCH` });
    if (command.type === 'subagent/batch-status') return batch(command.runId.replace('batch-', ''));
    throw new Error('Unexpected mutation or inventory request');
  });
  requests.push(request);
  const client = {
    supportsCommand: (type: HostCommand['type']) => !unsupported.includes(type), request,
    subscribePush: (listener: (push: HostPush) => void) => { pushes.add(listener); return () => pushes.delete(listener); },
    subscribeState: (listener: (state: HostClientState) => void) => { states.add(listener); listener({ kind: 'ready' }); return () => states.delete(listener); },
  } as unknown as HostClient;
  return { client, request, pushes, states,
    push: (push: HostPush) => { for (const listener of pushes) listener(push); },
    connection: (state: HostClientState) => { for (const listener of states) listener(state); },
  };
}
async function fixture(handler?: Handler, unsupported: HostCommand['type'][] = []) {
  const transport = makeClient(handler, unsupported);
  let host = { client: transport.client, activeSessionId: 'parent', connectionState: { kind: 'ready' } } as unknown as InkstoneHost;
  const dispatch = vi.fn();
  const draw = () => root.render(<InkstoneContext.Provider value={{ state: INITIAL_INKSTONE_STATE, dispatch }}>
    <InkstoneHostProvider value={{ host, onOpenConnection: vi.fn(), modelSelection: {} } as unknown as InkstoneHostContextValue}>
      <ReviewPage />
    </InkstoneHostProvider>
  </InkstoneContext.Provider>);
  await act(async () => { draw(); });
  return { ...transport, dispatch,
    replace: async (patch: Partial<InkstoneHost>) => { host = { ...host, ...patch }; await act(async () => { draw(); }); },
  };
}
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text) || item.getAttribute('aria-label') === text);
  if (found === undefined) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(text: string) { await act(async () => { button(text).click(); }); }
function calls(view: { request: ReturnType<typeof makeClient>['request'] }, type: HostCommand['type']) {
  return view.request.mock.calls.map(([command]) => command).filter((command) => command.type === type);
}
async function pushRefresh(view: ReturnType<typeof makeClient>, push: HostPush) {
  await act(async () => { view.push(push); await vi.advanceTimersByTimeAsync(55); });
}

describe('C1 readonly result review page and async ownership', () => {
  it('selects multiple exact results, renders public refs/availability, and lazily reads file 13+', async () => {
    const view = await fixture();
    expect(calls(view, 'subagent/results')[0]).toMatchObject({ parentSessionId: 'parent', pendingOnly: true, limit: 20 });
    expect(calls(view, 'subagent/result-diff')).toHaveLength(0);
    expect(container.textContent).toContain('review · r2');
    expect(container.textContent).toContain('verify · r3');
    expect(container.textContent).toContain('display only');
    await click('file-13.ts');
    expect(calls(view, 'subagent/result-diff')).toEqual([{ type: 'subagent/result-diff', resultId: 'one', revision: 1, fileId: 'file-13' }]);
    expect(container.textContent).toContain('file-13 PATCH');
    expect(container.textContent).toContain('无法确认完整Diff');
    await click('结果 two · r1');
    expect(calls(view, 'subagent/result-files').at(-1)).toMatchObject({ resultId: 'two', revision: 1, limit: 32 });
    expect(container.textContent).not.toContain('file-13 PATCH');
    expect(calls(view, 'subagent/batch-status')).toHaveLength(2);
    expect(container.textContent).not.toContain('NEVER SHOW');
    expect(container.textContent).toContain('Host 验收失败，不代表已交付');
    expect(container.querySelector('button[aria-label="审阅选项"]')).not.toBeNull();
    await click('审阅选项');
    expect(view.dispatch).toHaveBeenCalledWith({ type: 'open-sheet', key: 'review-options' });
  });
  it('loads bounded result/file cursor pages without silent 20/32/12 caps and switches pending/all', async () => {
    const view = await fixture((command) => {
      if (command.type === 'subagent/results') return ok(command.cursor === undefined ? {
        items: Array.from({ length: 20 }, (_, index) => result(`r${index + 1}`)), nextCursor: 'cursor-results',
      } : { items: [result('r21')] });
      if (command.type === 'subagent/result-files') return ok(command.cursor === undefined ? { files: files(1, 32), nextCursor: 'cursor-files' } : { files: files(33, 2) });
    });
    await click('加载更多结果');
    expect(container.textContent).toContain('已加载 21 个结果');
    expect(calls(view, 'subagent/results').at(-1)).toMatchObject({ cursor: 'cursor-results', limit: 20 });
    await click('结果 r21 · r1');
    await click('加载更多文件');
    expect(container.textContent).toContain('已加载 34 个文件引用');
    await click('file-34.ts');
    expect(calls(view, 'subagent/result-diff').at(-1)).toMatchObject({ resultId: 'r21', revision: 1, fileId: 'file-34' });
    await click('全部公开结果');
    expect(calls(view, 'subagent/results').at(-1)).toMatchObject({ pendingOnly: false });
    expect(container.textContent).not.toContain('file-34 PATCH');
    await click('待处理结果');
    expect(calls(view, 'subagent/results').at(-1)).toMatchObject({ pendingOnly: true });
  });
  it('labels applied + matched failed verification without treating it as delivered', async () => {
    await fixture((command) => command.type === 'subagent/results' ? ok({ items: [{ ...result(), integrationStatus: 'applied' }] }) : undefined);
    expect(container.textContent).toContain('已应用但验收失败，不代表已交付');
    expect(container.textContent).not.toContain('NEVER SHOW');
  });
  it.each(['unsupported', 'mismatch', 'error', 'absent'] as const)('keeps metadata readable with %s verification explicitly unknown', async (mode) => {
    const view = await fixture((command) => {
      if (command.type === 'subagent/results' && mode === 'absent') return ok({ items: [{ ...result(), latestVerification: null }] });
      if (command.type === 'subagent/batch-status') return mode === 'mismatch' ? batch('one', 9) : mode === 'error' ? failed('public batch error') : undefined;
    }, mode === 'unsupported' ? ['subagent/batch-status'] : []);
    expect(container.textContent).toContain('验收状态未公开/无法确认');
    expect(container.textContent).toContain('file-13.ts');
    if (mode === 'unsupported' || mode === 'absent') expect(calls(view, 'subagent/batch-status')).toHaveLength(0);
    if (mode === 'error') expect(container.textContent).toContain('public batch error');
  });
  it('labels ambiguous empty files and Host zero counts/empty patches without aggregate/no-change assertions', async () => {
    const view = await fixture((command) => command.type === 'subagent/result-files' ? ok({ files: [] }) : undefined);
    expect(container.textContent).toContain('Host返回空列表，无法确认确无变更或快照可用');
    expect(container.textContent).toContain('未公开文件总数/整体增删数');
    expect(calls(view, 'subagent/result-diff')).toHaveLength(0);
    const transport = makeClient((command) => command.type === 'subagent/result-diff' ? ok({ additions: 0, deletions: 0, binary: false, patch: '' }) : undefined);
    await view.replace({ client: transport.client });
    await click('file-13.ts');
    expect(container.textContent).toContain('+0 / −0');
    expect(container.textContent).toContain('零计数不证明无变更');
    expect(container.textContent).toContain('Host未提供完整性标记');
    expect(container.textContent).toContain('返回空补丁，无法确认');
  });
  it('shows unknown counts/binary/patch and separate local clipping, preserving MobileDiffViewer', async () => {
    let diff: unknown = {};
    await fixture((command) => command.type === 'subagent/result-diff' ? ok(diff) : undefined);
    await click('file-1.ts');
    expect(container.textContent).toContain('新增未知');
    expect(container.textContent).toContain('删除未知');
    expect(container.textContent).toContain('未公开二进制标记');
    diff = { binary: true, additions: null, deletions: null };
    await click('file-2.ts');
    expect(container.textContent).toContain('二进制文件');
    diff = { binary: false, patch: '@@ -1 +1 @@\n+clipped\n' + 'x'.repeat(PATCH_DISPLAY_LIMIT) };
    await click('file-3.ts');
    expect(container.textContent).toContain('客户端显示已截断');
    expect(container.textContent).toContain('无法确认完整Diff');
    expect(container.querySelector('[aria-label="代码变更 Diff"]')).not.toBeNull();
  });
  it.each(['subagent/results', 'subagent/result-files', 'subagent/result-diff'] as const)('gates unsupported %s reads without spinning', async (type) => {
    const view = await fixture(undefined, [type]);
    if (type === 'subagent/result-diff') await click('file-13.ts');
    expect(calls(view, type)).toHaveLength(0);
    expect(container.textContent).toContain(`Host 未开放 ${type}`);
    expect(container.textContent).not.toContain('正在读取');
  });
  it('displays view:false reason without files/diff requests or invented availability', async () => {
    const view = await fixture((command) => command.type === 'subagent/results' ? ok({ items: [{ ...result(), availability: { view: { allowed: false, reason: 'snapshot expired' } } }] }) : undefined);
    expect(container.textContent).toContain('snapshot expired');
    expect(container.textContent).toContain('apply：未公开/无法确认');
    expect(calls(view, 'subagent/result-files')).toHaveLength(0);
    expect(calls(view, 'subagent/result-diff')).toHaveLength(0);
  });
  it('reports public list/diff errors and malformed result metadata explicitly', async () => {
    const view = await fixture((command) => command.type === 'subagent/result-files' ? failed('files denied') : undefined);
    expect(container.textContent).toContain('files denied');
    expect(container.textContent).not.toContain('Host返回空列表');
    await view.replace({ client: makeClient((command) => command.type === 'subagent/results' ? ok({ items: [{ ...result(), revision: 0 }] }) : undefined).client });
    expect(container.textContent).toContain('无法确认引用');
    expect(container.textContent).not.toContain('Host 未返回结果条目');
    await view.replace({ client: makeClient((command) => command.type === 'subagent/result-diff' ? failed('diff denied') : undefined).client });
    await click('file-1.ts');
    expect(container.textContent).toContain('diff denied');
  });
  it('shows genuine empty results and missing session without any read or mutation', async () => {
    const view = await fixture((command) => command.type === 'subagent/results' ? ok({ items: [] }) : undefined);
    expect(container.textContent).toContain('Host 未返回结果条目');
    const count = view.request.mock.calls.length;
    await view.replace({ activeSessionId: undefined });
    expect(container.textContent).toContain('还没有选中会话');
    expect(view.request.mock.calls).toHaveLength(count);
  });
  it('terminates repeated result and file cursors without a request loop', async () => {
    const view = await fixture((command) => {
      if (command.type === 'subagent/results') return ok({ items: [result()], nextCursor: 'repeat-result' });
      if (command.type === 'subagent/result-files') return ok({ files: files(), nextCursor: 'repeat-file' });
    });
    await click('加载更多文件');
    expect(container.textContent).toContain('重复返回分页游标');
    expect(container.textContent).not.toContain('加载更多文件');
    await click('加载更多结果');
    expect(container.textContent).not.toContain('加载更多结果');
    expect(calls(view, 'subagent/results')).toHaveLength(2);
    expect(calls(view, 'subagent/result-files')).toHaveLength(2);
  });
  it('ignores foreign pushes, coalesces current pushes, clears old diff and preserves selected result', async () => {
    vi.useFakeTimers();
    let revision = 1;
    const view = await fixture((command) => command.type === 'subagent/results' ? ok({ items: [result(), result('two', revision)] }) : undefined);
    await click('结果 two · r1'); await click('file-13.ts');
    const count = view.request.mock.calls.length;
    await pushRefresh(view, { type: 'subagent/result-updated', parentSessionId: 'foreign', result: result() } as HostPush);
    expect(view.request.mock.calls).toHaveLength(count);
    revision = 2;
    act(() => {
      for (const type of ['subagent/invocation-updated', 'subagent/merged', 'subagent/batch-updated', 'subagent/task-updated', 'subagent/result-updated']) {
        view.push({ type, parentSessionId: 'parent' } as HostPush);
      }
    });
    expect(container.textContent).not.toContain('file-13 PATCH');
    expect(container.textContent).toContain('快照已失效');
    await act(async () => { await vi.advanceTimersByTimeAsync(55); });
    expect(calls(view, 'subagent/results')).toHaveLength(2);
    expect(calls(view, 'subagent/result-files').at(-1)).toMatchObject({ resultId: 'two', revision: 2 });
    expect(container.textContent).toContain('two · r2');
    expect(container.textContent).toContain('选择文件后');
    expect(container.textContent).toContain('验收状态未公开/无法确认'); // old batch receipt is r1
  });
  it('refreshes previously loaded result pages preserving late-page selection, and falls back only when gone', async () => {
    vi.useFakeTimers(); let gone = false;
    const view = await fixture((command) => command.type === 'subagent/results' ? ok(command.cursor === undefined ?
      { items: [result()], nextCursor: 'second' } : { items: gone ? [] : [result('two')] }) : undefined);
    await click('加载更多结果'); await click('结果 two · r1');
    await pushRefresh(view, { type: 'subagent/merged', parentSessionId: 'parent', childSessionId: 'c', messageId: 'm' });
    expect(calls(view, 'subagent/result-files').at(-1)).toMatchObject({ resultId: 'two' });
    gone = true;
    await pushRefresh(view, { type: 'subagent/merged', parentSessionId: 'parent', childSessionId: 'c', messageId: 'm' });
    expect(calls(view, 'subagent/result-files').at(-1)).toMatchObject({ resultId: 'one' });
  });
  it('guards reversed rapid file responses and reversed result files/verification responses', async () => {
    const first = deferred(), second = deferred(), oldFiles = deferred(), oldVerification = deferred();
    const view = await fixture((command) => {
      if (command.type === 'subagent/result-diff') return command.fileId === 'file-1' ? first.promise : second.promise;
      if (command.type === 'subagent/result-files' && command.resultId === 'one') return oldFiles.promise;
      if (command.type === 'subagent/batch-status' && command.runId === 'batch-one') return oldVerification.promise;
    });
    await click('结果 two · r1');
    await click('file-1.ts'); await click('file-2.ts');
    await act(async () => { second.resolve(ok({ patch: '@@ -1 +1 @@\n+NEW FILE' })); });
    await act(async () => {
      first.resolve(ok({ patch: '@@ -1 +1 @@\n+OLD FILE' })); oldFiles.resolve(ok({ files: [{ fileId: 'old', relativePath: 'OLD FILES', kind: 'added' }] }));
      oldVerification.resolve(batch('one', 1, 'passed'));
    });
    expect(container.textContent).toContain('NEW FILE');
    expect(container.textContent).not.toMatch(/OLD FILE|OLD FILES|验收通过/);
    expect(calls(view, 'subagent/result-diff').map((command) => 'resultId' in command ? command.resultId : '')).toEqual(['two', 'two']);
  });
  it.each(['session', 'client', 'filter'] as const)('guards old %s result page resolving after current selection', async (mode) => {
    const old = deferred(); let reads = 0;
    const view = await fixture((command) => {
      if (command.type === 'subagent/results' && reads++ === 0) return old.promise;
    });
    if (mode === 'session') await view.replace({ activeSessionId: 'new-session' });
    if (mode === 'client') await view.replace({ client: makeClient().client });
    if (mode === 'filter') await click('全部公开结果');
    await act(async () => { old.resolve(ok({ items: [result('OLD RESULT')] })); });
    expect(container.textContent).not.toContain('OLD RESULT');
    expect(container.textContent).toContain('file-13.ts');
    if (mode === 'session') expect(container.textContent).toContain('会话 new-session');
  });
  it('invalidates in-flight revision diff/files/verification on push and never refetches concurrently in a storm', async () => {
    vi.useFakeTimers(); const staleDiff = deferred(), staleFiles = deferred(), staleVerification = deferred(), refresh = deferred();
    let resultReads = 0, fileReads = 0, batchReads = 0;
    const view = await fixture((command) => {
      if (command.type === 'subagent/results') { resultReads += 1; if (resultReads === 2) return refresh.promise; return ok({ items: [result('one', resultReads === 1 ? 1 : 2)] }); }
      if (command.type === 'subagent/result-files' && ++fileReads === 2) return staleFiles.promise;
      if (command.type === 'subagent/result-files') return ok({ files: files(), nextCursor: fileReads === 1 ? 'more' : undefined });
      if (command.type === 'subagent/result-diff') return staleDiff.promise;
      if (command.type === 'subagent/batch-status' && ++batchReads === 1) return staleVerification.promise;
    });
    await click('file-13.ts'); await click('加载更多文件');
    await pushRefresh(view, { type: 'subagent/merged', parentSessionId: 'parent', childSessionId: 'c', messageId: 'm' });
    for (let index = 0; index < 5; index += 1) await pushRefresh(view, { type: 'subagent/merged', parentSessionId: 'parent', childSessionId: 'c', messageId: 'm' });
    expect(resultReads).toBe(2);
    await act(async () => {
      staleDiff.resolve(ok({ patch: '@@ -1 +1 @@\n+OLD REV DIFF' })); staleFiles.resolve(ok({ files: [{ fileId: 'old', relativePath: 'OLD REV FILE', kind: 'added' }] }));
      staleVerification.resolve(batch('one', 1, 'passed')); refresh.resolve(ok({ items: [result('one', 1)] }));
      await vi.advanceTimersByTimeAsync(55);
    });
    expect(resultReads).toBe(3);
    expect(container.textContent).toContain('one · r2');
    expect(container.textContent).not.toMatch(/OLD REV|验收通过/);
  });
  it('disconnect immediately prevents late writes/reads, reconnect hydrates, unmount disposes subscriptions/timers', async () => {
    vi.useFakeTimers(); const diff = deferred();
    const view = await fixture((command) => command.type === 'subagent/result-diff' ? diff.promise : undefined);
    await click('file-13.ts');
    act(() => view.connection({ kind: 'disconnected', reason: 'test' }));
    expect(container.textContent).toContain('快照已失效');
    await act(async () => { diff.resolve(ok({ patch: '@@ -1 +1 @@\n+LATE DISCONNECTED' })); });
    expect(container.textContent).not.toContain('LATE DISCONNECTED');
    const before = view.request.mock.calls.length;
    await click('刷新公开结果');
    await act(async () => { await vi.advanceTimersByTimeAsync(55); });
    expect(view.request.mock.calls).toHaveLength(before);
    await view.replace({ connectionState: { kind: 'disconnected' } });
    expect(container.textContent).toContain('Host 已断开');
    expect(container.textContent).not.toContain('file-13.ts');
    await view.replace({ connectionState: { kind: 'ready' } });
    expect(container.textContent).toContain('file-13.ts');
    act(() => { view.push({ type: 'subagent/merged', parentSessionId: 'parent', childSessionId: 'c', messageId: 'm' }); root.unmount(); mounted = false; });
    expect(view.pushes.size).toBe(0); expect(view.states.size).toBe(0);
    const count = view.request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(view.request.mock.calls).toHaveLength(count);
  });
  it('unmount before result promise resolves causes no writes or follow-up reads', async () => {
    const old = deferred(); const view = await fixture((command) => command.type === 'subagent/results' ? old.promise : undefined);
    act(() => { root.unmount(); mounted = false; });
    await act(async () => { old.resolve(ok({ items: [result()] })); });
    expect(view.request.mock.calls).toHaveLength(1);
    expect(view.pushes.size).toBe(0); expect(view.states.size).toBe(0);
  });
});
