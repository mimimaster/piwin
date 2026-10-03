// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import type { HostClient, HostClientState } from '@piwin/host-client';
import { QuestionCard } from '../transcript/QuestionCard.js';
import { useSessionLiveState, type SessionLiveState } from './use-session-live-state.js';

function summary(overrides: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'at-1',
    sessionId: 's1',
    workspaceId: 'ws',
    userMessageId: null,
    runIds: ['r1'],
    revision: 1,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 1,
    additions: 1,
    deletions: 0,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let latest: SessionLiveState | undefined;

function Probe(props: { client?: HostClient; sessionId?: string; card?: boolean }): ReactElement | null {
  latest = useSessionLiveState(props.client, props.sessionId ?? 's1');
  return props.card && latest.extensionUi !== undefined
    ? <QuestionCard prompt={latest.extensionUi} onAnswer={latest.resolveExtensionUi} /> : null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  latest = undefined;
});

describe('useSessionLiveState turn changes', () => {
  it('fetches history summaries once per run and keeps a newer pushed revision', async () => {
    let listener: ((push: HostPush) => void) | undefined;
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: true,
      data: command.type === 'turn-changes/list-by-runs' ? { summaries: [summary()] } : {},
    }));
    const client = {
      supportsCommand: (type: string) => type === 'turn-changes/list-by-runs',
      subscribeState: (next: (state: HostClientState) => void) => { next({ kind: 'ready' }); return () => undefined; },
      request,
      subscribePush: (next: (push: HostPush) => void) => {
        listener = next;
        return () => undefined;
      },
    } as unknown as HostClient;

    await act(async () => root.render(<Probe client={client} />));
    await act(async () => {
      latest?.ensureTurnChanges(['r1']);
      latest?.ensureTurnChanges(['r1']);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const lookups = request.mock.calls.filter(([command]) => command.type === 'turn-changes/list-by-runs');
    expect(lookups).toHaveLength(1);
    expect(latest?.changesByRunId.get('r1')?.disposition).toBe('applied');

    await act(async () => {
      listener?.({
        type: 'turn-changes/updated',
        workspaceId: 'ws',
        changeSetId: 'cs-1',
        revision: 2,
        summary: summary({ revision: 2, disposition: 'undone' }),
      });
    });
    expect(latest?.changesByRunId.get('r1')?.disposition).toBe('undone');
  });
});

function deferred() {
  let resolve: (response: HostResponse) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<HostResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ok: HostResponse = { type: 'response', command: 'extension/ui_resolve', success: true, data: {} };
const refused: HostResponse = { type: 'response', command: 'extension/ui_resolve', success: false, error: 'try again' };
function question(requestId = 'q1', sessionId = 's1'): HostPush {
  return { type: 'extension/ui_request', sessionId, requestId, kind: 'confirm', title: requestId };
}
function questionnaireHost(supported = true) {
  let push: ((value: HostPush) => void) | undefined;
  let state: ((value: HostClientState) => void) | undefined;
  const first = deferred();
  const second = deferred();
  const unsubscribePush = vi.fn();
  const unsubscribeState = vi.fn();
  const request = vi.fn<(command: HostCommand) => Promise<HostResponse>>()
    .mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const client = {
    supportsCommand: (type: string) => supported && type === 'extension/ui_resolve', request,
    subscribePush: (listener: (value: HostPush) => void) => { push = listener; return unsubscribePush; },
    subscribeState: (listener: (value: HostClientState) => void) => { state = listener; listener({ kind: 'ready' }); return unsubscribeState; },
  } as unknown as HostClient;
  return { client, request, first, second, unsubscribePush, unsubscribeState,
    push: (value: HostPush) => push?.(value), state: (value: HostClientState) => state?.(value) };
}
function live(): SessionLiveState {
  if (latest === undefined) throw new Error('missing probe');
  return latest;
}

describe('questionnaire ownership and inline busy/error controls', () => {
  it('synchronously latches double answers before the first await and rejects stale callbacks', async () => {
    const h = questionnaireHost();
    act(() => root.render(<Probe client={h.client} />));
    act(() => h.push(question()));
    const stale = live().resolveExtensionUi;
    let pending = Promise.resolve(false);
    let duplicate = Promise.resolve(true);
    act(() => { pending = stale({ kind: 'confirm', confirmed: true }); h.push(question()); duplicate = stale({ kind: 'cancel' }); });
    expect(h.request).toHaveBeenCalledTimes(1);
    await expect(duplicate).resolves.toBe(false);
    expect(h.request.mock.calls[0]?.[0]).toEqual({ type: 'extension/ui_resolve', requestId: 'q1', confirmed: true });
    act(() => h.push(question('q2')));
    await expect(stale({ kind: 'cancel' })).resolves.toBe(false);
    await act(async () => { h.first.resolve(ok); await pending; });
    expect(live().extensionUi?.requestId).toBe('q2');
  });

  it.each(['success', 'reject'] as const)('a new prompt is not locked or mutated by old %s/finally', async (outcome) => {
    const h = questionnaireHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    act(() => root.render(<Probe client={h.client} card />));
    act(() => h.push(question()));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.click());
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    act(() => h.push(question('q2')));
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.disabled).toBe(false);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.click());
    await act(async () => { if (outcome === 'success') h.first.resolve(ok); else h.first.reject(new Error('old error')); });
    expect(live().extensionUi?.requestId).toBe('q2');
    expect(container.textContent).not.toContain('old error');
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.disabled).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(2);
    await act(async () => h.second.resolve(ok));
    expect(live().extensionUi).toBeUndefined();
    warn.mockRestore();
  });

  it.each(['refused', 'reject'] as const)('keeps inline %s errors and permits legitimate retry', async (outcome) => {
    const h = questionnaireHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    act(() => root.render(<Probe client={h.client} card />));
    act(() => h.push(question()));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="是"]');
    act(() => { button?.click(); button?.click(); });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.error-text')).toBeNull();
    await act(async () => { if (outcome === 'refused') h.first.resolve(refused); else h.first.reject(new Error('retryable')); });
    expect(container.querySelector('.error-text')?.textContent).toContain(outcome === 'reject' ? 'retryable' : '请重试');
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.disabled).toBe(false);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.click());
    await act(async () => h.second.resolve(ok));
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(live().extensionUi).toBeUndefined();
    warn.mockRestore();
  });

  it('capability denial does not send any answer and displays the existing inline retry error', async () => {
    const h = questionnaireHost(false);
    act(() => root.render(<Probe client={h.client} card />));
    act(() => h.push(question()));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="是"]')?.click());
    expect(h.request).not.toHaveBeenCalled();
    expect(container.querySelector('.error-text')?.textContent).toContain('请重试');
  });

  it.each(['session', 'client', 'disconnect', 'unmount'] as const)('rejects late errors after %s and unsubscribes appropriately', async (change) => {
    const h = questionnaireHost();
    const next = questionnaireHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    act(() => root.render(<Probe client={h.client} card />));
    act(() => h.push(question()));
    let pending = Promise.resolve(false);
    act(() => { pending = live().resolveExtensionUi({ kind: 'value', value: 'answer' }); });
    if (change === 'session') { act(() => root.render(<Probe client={h.client} sessionId="s2" card />)); act(() => h.push(question('q1', 's2'))); }
    if (change === 'client') { act(() => root.render(<Probe client={next.client} card />)); act(() => next.push(question())); }
    if (change === 'disconnect') { act(() => h.state({ kind: 'disconnected' })); act(() => h.state({ kind: 'ready' })); act(() => h.push(question())); }
    if (change === 'unmount') act(() => root.render(null));
    await act(async () => { h.first.reject(new Error('old error')); expect(await pending).toBe(true); });
    expect(container.textContent).not.toContain('old error');
    if (change !== 'unmount') expect(live().extensionUi?.requestId).toBe('q1');
    if (change !== 'disconnect') { expect(h.unsubscribePush).toHaveBeenCalledTimes(1); expect(h.unsubscribeState).toHaveBeenCalledTimes(1); }
    warn.mockRestore();
  });

  it('clears only current-session questions on authoritative terminal, not foreign updated/terminal runs', async () => {
    const h = questionnaireHost();
    act(() => root.render(<Probe client={h.client} />));
    act(() => h.push(question()));
    const run = { runId: 'r1', rootRunId: 'r1', sessionId: 'foreign', kind: 'session-turn' as const, status: 'completed' as const };
    act(() => { h.push({ type: 'run/updated', run }); h.push({ type: 'run/terminal', run }); });
    expect(live().extensionUi?.requestId).toBe('q1');
    let pending = Promise.resolve(false);
    act(() => { pending = live().resolveExtensionUi({ kind: 'cancel' }); h.push({ type: 'run/terminal', run: { ...run, sessionId: 's1' } }); });
    await act(async () => { h.first.resolve(ok); await pending; });
    expect(live().extensionUi).toBeUndefined();
  });

  it('disables input and suppresses stale QuestionCard failure after an in-place prompt replacement', async () => {
    const first = deferred();
    const answer = vi.fn(async () => { await first.promise; return false; });
    const prompt = { sessionId: 's1', requestId: 'q1', kind: 'input' as const, title: 'Input', options: [], message: undefined, placeholder: undefined };
    act(() => root.render(<QuestionCard prompt={prompt} onAnswer={answer} />));
    const input = container.querySelector('textarea');
    if (input === null) throw new Error('missing textarea');
    // Cancel exercises the input card's same busy latch without submitting a real prompt.
    act(() => { container.querySelector<HTMLButtonElement>('button')?.click(); container.querySelector<HTMLButtonElement>('button')?.click(); });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(input.disabled).toBe(true);
    act(() => root.render(<QuestionCard prompt={{ ...prompt, requestId: 'q2' }} onAnswer={answer} />));
    await act(async () => first.resolve(ok));
    expect(container.querySelector('textarea')?.disabled).toBe(false);
    expect(container.querySelector('.error-text')).toBeNull();
  });
});
