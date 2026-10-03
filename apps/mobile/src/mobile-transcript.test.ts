// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostClient } from '@piwin/host-client';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { useMobilePermission } from './hooks/mobile-run-controls.js';
import { PermissionGateCard } from './inkstone/transcript/PermissionGateCard.js';
import { applyHostPushToForeground, initialForegroundRunState, reduceForegroundRun } from '@piwin/host-client';
import type { HostPush, ToolPresentation } from '@piwin/contracts';
import {
  handleRemotePush,
  readSessionMessages,
  type MobileTranscriptMessage,
  type RemotePermissionRequest,
} from './mobile-transcript.js';

const HEALTH_PRESENTATION: ToolPresentation = {
  kind: 'health',
  title: '读取 Apple Health',
  summary: '近 7 天：睡眠、步数',
  health: {
    metrics: ['steps', 'sleep-duration'],
    periodLabel: '近 7 天',
    status: 'waiting-for-phone',
  },
};

/**
 * Payload shape asserted by host-server remote-health-projection.test.ts after
 * projectRemoteResponse(session/messages). Mobile cannot import host-server.
 */
const PROJECTED_HEALTH_TOOL_CARD = {
  toolCallId: 'health-1',
  toolName: 'health_read_context',
  status: 'done',
  output: 'These values are user-authorized Apple Health summaries.\nsleep-duration 420',
  presentation: {
    kind: 'health' as const,
    title: '读取 Apple Health',
    summary: '近 7 天：睡眠、步数',
    sensitivity: 'health' as const,
    health: {
      metrics: ['steps', 'sleep-duration'] as const,
      periodLabel: '近 7 天',
      status: 'completed' as const,
      freshnessLabel: '08:42',
      timezone: 'Asia/Shanghai',
      unavailableMetrics: ['heart-rate-variability'] as const,
      warnings: ['partial-result'] as const,
    },
  },
};

function collectMessages(): {
  activeSessionRef: { current: string | undefined };
  messages: () => MobileTranscriptMessage[];
  setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>>;
  setPausedCheckpointId: Dispatch<SetStateAction<string | undefined>>;
  setPermissionRequest: Dispatch<SetStateAction<RemotePermissionRequest | undefined>>;
} {
  let messages: MobileTranscriptMessage[] = [];
  const setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>> = (update) => {
    messages = typeof update === 'function' ? update(messages) : update;
  };
  return {
    activeSessionRef: { current: 'session-1' },
    messages: () => messages,
    setMessages,
    setPausedCheckpointId: () => undefined,
    setPermissionRequest: () => undefined,
  };
}

function pushEvent(event: Extract<HostPush, { type: 'event' }>['event']): HostPush {
  return { type: 'event', sessionId: 'session-1', event };
}

describe('mobile transcript health presentation', () => {
  it('copies Host presentation through live tool/start and tool/end', () => {
    const harness = collectMessages();
    handleRemotePush(
      pushEvent({
        type: 'message/start',
        messageId: 'msg-1',
        role: 'assistant',
        runId: 'run-1',
        model: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
      }),
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    handleRemotePush(
      pushEvent({
        type: 'tool/start',
        toolCallId: 'health-1',
        toolName: 'health_read_context',
        responseMessageId: 'msg-1',
        presentation: HEALTH_PRESENTATION,
      }),
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()[0]?.model).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
    });
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation).toEqual(HEALTH_PRESENTATION);

    handleRemotePush(
      pushEvent({
        type: 'tool/end',
        toolCallId: 'health-1',
        isError: false,
        responseMessageId: 'msg-1',
        presentation: {
          ...HEALTH_PRESENTATION,
          health: {
            metrics: ['steps', 'sleep-duration'],
            periodLabel: '近 7 天',
            status: 'completed',
            freshnessLabel: '08:42',
          },
        },
      }),
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation?.kind).toBe('health');
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation?.health?.status).toBe('completed');
  });

  it('copies Host presentation from session/messages hydrate', () => {
    const messages = readSessionMessages({
      success: true,
      data: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            text: '这是摘要。',
            createdAt: '2026-08-23T12:00:00.000Z',
            status: 'done',
            tools: [PROJECTED_HEALTH_TOOL_CARD],
          },
        ],
      },
    });
    expect(messages[0]?.toolCalls?.[0]?.presentation).toMatchObject({
      kind: 'health',
      title: '读取 Apple Health',
      sensitivity: 'health',
      health: {
        status: 'completed',
        periodLabel: '近 7 天',
        freshnessLabel: '08:42',
      },
    });
  });

  it('projects Health presentation from transcript/append hydrate', () => {
    const harness = collectMessages();
    handleRemotePush(
      {
        type: 'transcript/append',
        sessionId: 'session-1',
        message: {
          id: 'msg-2',
          role: 'assistant',
          text: '部分结果。',
          createdAt: '2026-08-23T12:01:00.000Z',
          status: 'done',
          tools: [
            {
              toolCallId: 'health-2',
              toolName: 'health_read_context',
              status: 'done',
              output: '',
              presentation: {
                ...HEALTH_PRESENTATION,
                health: {
                  metrics: ['sleep-duration'],
                  periodLabel: '昨晚',
                  status: 'no-data',
                },
              },
            },
          ],
        },
      },
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation?.health?.status).toBe('no-data');
  });
});

describe('mobile display-only presentation passthrough', () => {
  const result = { resultId: 'result-1', revision: 2 };
  const presentations: ToolPresentation[] = [
    { kind: 'other', title: 'goal_complete', goal: {
      phase: 'completed', summary: 'Verified', verification: 'tests passed', artifacts: ['src/app.ts'],
    } },
    { kind: 'other', title: 'goal_blocked', goal: {
      phase: 'blocked', reason: 'Needs decision', unblockAction: 'Choose preview scope',
    } },
    { kind: 'other', title: 'goal_wait', goal: {
      phase: 'waited', reason: 'External job', durationSeconds: 10,
    } },
    { kind: 'other', title: 'result-read', subagentLoop: {
      kind: 'result-read', result, mode: 'summary', summary: 'Candidate ready',
    } },
    { kind: 'other', title: 'review-submit', subagentLoop: {
      kind: 'review-submit', reviewRef: { reviewId: 'review-1', revision: 1 },
      decision: 'changes-requested', target: result,
    } },
    { kind: 'other', title: 'result-apply', subagentLoop: {
      kind: 'result-apply', result, operationId: 'op-1', integrationStatus: 'applied',
    } },
    { kind: 'other', title: 'result-discard', subagentLoop: {
      kind: 'result-discard', result, integrationStatus: 'discarded', alreadySettled: true,
    } },
    { kind: 'other', title: 'verification-submit', subagentLoop: {
      kind: 'verification-submit', result,
      verificationRef: { verificationId: 'verification-1', revision: 1 }, status: 'passed',
    } },
  ];

  // Public Host-authored shapes only; no Pi details or new Goal push contract.
  it.each(presentations)('preserves $title through start/update/end', (presentation) => {
    const harness = collectMessages();
    const push = (event: Extract<HostPush, { type: 'event' }>['event']) => handleRemotePush(
      pushEvent(event), harness.activeSessionRef, harness.setMessages,
      harness.setPausedCheckpointId, harness.setPermissionRequest,
    );
    push({ type: 'tool/start', toolCallId: 'tool-1', toolName: presentation.title,
      responseMessageId: 'msg-1', presentation });
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation).toEqual(presentation);
    const updated = { ...presentation, summary: 'Host update' };
    push({ type: 'tool/update', toolCallId: 'tool-1', delta: '',
      responseMessageId: 'msg-1', presentation: updated });
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation).toEqual(updated);
    push({ type: 'tool/end', toolCallId: 'tool-1', isError: false,
      responseMessageId: 'msg-1', presentation });
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation).toEqual(presentation);
    expect(harness.messages()[0]?.toolCalls?.[0]?.status).toBe('done');
  });

  it.each(presentations)('preserves $title on hydrate and transcript/append', (presentation) => {
    const message = {
      id: 'msg-1', role: 'assistant' as const, text: 'Host summary',
      createdAt: '2026-10-02T00:00:00.000Z', status: 'done' as const,
      tools: [{ toolCallId: 'tool-1', toolName: presentation.title,
        status: 'done' as const, output: '', presentation }],
    };
    const messages = readSessionMessages({ success: true, data: { messages: [message] } });
    expect(messages[0]?.toolCalls?.[0]?.presentation).toEqual(presentation);
    const harness = collectMessages();
    handleRemotePush({ type: 'transcript/append', sessionId: 'session-1', message },
      harness.activeSessionRef, harness.setMessages,
      harness.setPausedCheckpointId, harness.setPermissionRequest);
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation).toEqual(presentation);
  });
});

function permission(requestId = 'p1', sessionId = 'session-1'): RemotePermissionRequest {
  return { type: 'permission/request', sessionId, requestId, action: 'bash', detail: 'mock only', defaultDecision: 'ask' };
}

function deferredResponse() {
  let resolve: (response: HostResponse) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<HostResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const permissionOk: HostResponse = { type: 'response', command: 'permission/resolve', success: true, data: {} };
let permissionRoot: Root | undefined;
let permissionContainer: HTMLDivElement | undefined;
afterEach(() => {
  if (permissionRoot !== undefined) act(() => permissionRoot?.unmount());
  permissionContainer?.remove();
  permissionRoot = undefined;
});

function permissionHarness() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const first = deferredResponse();
  const second = deferredResponse();
  const request = vi.fn<(command: HostCommand) => Promise<HostResponse>>()
    .mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const client = { request, getState: () => ({ kind: 'ready' }) } as unknown as HostClient;
  const clientRef = { current: client as HostClient | undefined };
  const activeSessionRef = { current: 'session-1' as string | undefined };
  const error = vi.fn();
  const refresh = vi.fn(async () => undefined);
  let latest: ReturnType<typeof useMobilePermission> | undefined;
  function Probe() {
    latest = useMobilePermission({ clientRef, activeSessionRef, setErrorMessage: error, onResolved: refresh });
    return latest.permissionRequest === undefined ? null : createElement(PermissionGateCard, {
      request: latest.permissionRequest, resolving: latest.isResolvingPermission,
      onResolve: () => undefined, onOpenDetail: () => undefined,
    });
  }
  permissionContainer = document.createElement('div');
  document.body.append(permissionContainer);
  permissionRoot = createRoot(permissionContainer);
  act(() => permissionRoot?.render(createElement(Probe)));
  const state = () => {
    if (latest === undefined) throw new Error('probe missing');
    return latest;
  };
  const push = (value: HostPush) => handleRemotePush(value, activeSessionRef, () => undefined, () => undefined, state().setPermissionRequest);
  act(() => push(permission()));
  return { first, second, clientRef, activeSessionRef, request, error, refresh, state, push };
}

describe('permission live ownership', () => {
  it.each(['standalone', 'nested'] as const)('clears only exact session/request through %s resolution', (kind) => {
    const h = permissionHarness();
    const resolved = (sessionId: string, requestId: string): HostPush => kind === 'standalone'
      ? { type: 'permission/resolved', sessionId, requestId, decision: 'allow' }
      : { type: 'event', sessionId, event: { type: 'permission/resolved', requestId, decision: 'allow' } };
    act(() => { h.push(permission('foreign', 'other')); h.push(resolved('other', 'p1')); h.push(resolved('session-1', 'old')); });
    expect(h.state().permissionRequest?.requestId).toBe('p1');
    act(() => h.push(permission('p2')));
    act(() => h.push(resolved('session-1', 'p1')));
    expect(h.state().permissionRequest?.requestId).toBe('p2');
    act(() => h.push(resolved('session-1', 'p2')));
    expect(h.state().permissionRequest).toBeUndefined();
  });

  it('matches the stored session even without an active selection', () => {
    const h = permissionHarness();
    h.activeSessionRef.current = undefined;
    act(() => h.push({ type: 'permission/resolved', sessionId: 'other', requestId: 'p1', decision: 'deny' }));
    expect(h.state().permissionRequest?.requestId).toBe('p1');
    act(() => h.push({ type: 'permission/resolved', sessionId: 'session-1', requestId: 'p1', decision: 'deny' }));
    expect(h.state().permissionRequest).toBeUndefined();
  });

  it('latches duplicate immediate calls, rejects stale IDs and disables the existing buttons', async () => {
    const h = permissionHarness();
    await expect(h.state().handleResolvePermission('allow', 'old')).resolves.toBe(false);
    let first: Promise<boolean> = Promise.resolve(false);
    let duplicate: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = h.state().handleResolvePermission('allow');
      h.push(permission()); // Replayed same request cannot release the latch.
      duplicate = h.state().handleResolvePermission('deny');
    });
    await expect(duplicate).resolves.toBe(false);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.request.mock.calls[0]?.[0]).toMatchObject({ type: 'permission/resolve', requestId: 'p1', decision: 'allow', rememberScope: 'once' });
    expect(permissionContainer?.querySelector<HTMLButtonElement>('button[aria-label="拒绝"]')?.disabled).toBe(true);
    expect(permissionContainer?.querySelector<HTMLButtonElement>('button[aria-label="允许"]')?.disabled).toBe(true);
    await act(async () => { h.first.resolve(permissionOk); expect(await first).toBe(true); });
    expect(h.state().permissionRequest).toBeUndefined();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)('old %s/finally cannot clear, error or unlock a new resolving request', async (outcome) => {
    const h = permissionHarness();
    let old: Promise<boolean> = Promise.resolve(false);
    let next: Promise<boolean> = Promise.resolve(false);
    act(() => { old = h.state().handleResolvePermission('allow', 'p1', 'session'); });
    act(() => { h.push(permission('p2')); next = h.state().handleResolvePermission('deny', 'p2', 'project'); });
    expect(h.request).toHaveBeenCalledTimes(2);
    h.error.mockClear();
    await act(async () => {
      if (outcome === 'success') h.first.resolve(permissionOk); else h.first.reject(new Error('old failure'));
      expect(await old).toBe(false);
    });
    expect(h.state().permissionRequest?.requestId).toBe('p2');
    expect(h.state().isResolvingPermission).toBe(true);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.request.mock.calls.map(([command]) => command)).toMatchObject([
      { rememberScope: 'session' }, { rememberScope: 'project' },
    ]);
    await act(async () => { h.second.resolve(permissionOk); await next; });
  });

  it('other-device resolution does not become a zombie after a late failure', async () => {
    const h = permissionHarness();
    let old: Promise<boolean> = Promise.resolve(false);
    act(() => { old = h.state().handleResolvePermission('allow'); });
    act(() => h.push({ type: 'permission/resolved', sessionId: 'session-1', requestId: 'p1', decision: 'allow' }));
    h.error.mockClear();
    await act(async () => { h.first.reject(new Error('already resolved')); expect(await old).toBe(false); });
    expect(h.state().permissionRequest).toBeUndefined();
    expect(h.state().isResolvingPermission).toBe(false);
    expect(h.error).not.toHaveBeenCalled();
  });

  it('legitimate failure permits retry of the matching request', async () => {
    const h = permissionHarness();
    let attempt: Promise<boolean> = Promise.resolve(false);
    act(() => { attempt = h.state().handleResolvePermission('allow'); });
    await act(async () => { h.first.reject(new Error('retry me')); expect(await attempt).toBe(false); });
    expect(h.error).toHaveBeenLastCalledWith('retry me');
    expect(h.state().isResolvingPermission).toBe(false);
    act(() => { attempt = h.state().handleResolvePermission('deny'); });
    await act(async () => { h.second.resolve(permissionOk); expect(await attempt).toBe(true); });
  });

  it.each(['client', 'session', 'unmount'] as const)('late result cannot mutate replaced %s ownership', async (change) => {
    const h = permissionHarness();
    let attempt: Promise<boolean> = Promise.resolve(false);
    act(() => { attempt = h.state().handleResolvePermission('allow'); });
    h.error.mockClear();
    if (change === 'client') h.clientRef.current = { getState: () => ({ kind: 'ready' }) } as unknown as HostClient;
    if (change === 'session') h.activeSessionRef.current = 'other';
    if (change === 'unmount') { act(() => permissionRoot?.unmount()); permissionRoot = undefined; }
    await act(async () => { h.first.reject(new Error('old')); expect(await attempt).toBe(false); });
    expect(h.error).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe('authoritative run outcome independent of Goal heads', () => {
  it('keeps failed transcript outcomes independent of Goal heads and follows current-session run lifecycle', () => {
    const h = collectMessages();
    const push = (value: HostPush) => handleRemotePush(value, h.activeSessionRef, h.setMessages, h.setPausedCheckpointId, h.setPermissionRequest);
    push(pushEvent({ type: 'message/start', messageId: 'm1', role: 'assistant', runId: 'r1' }));
    const run = { runId: 'r1', kind: 'session-turn' as const, sessionId: 'session-1', rootRunId: 'r1', revision: 2, status: 'failed' as const, error: 'Host failure' };
    push({ type: 'run/terminal', run: { ...run, sessionId: 'foreign' } });
    expect(h.messages()[0]?.status).toBe('streaming');
    push({ type: 'run/terminal', run });
    push(pushEvent({ type: 'tool/start', toolCallId: 'g1', toolName: 'goal_complete', responseMessageId: 'm1', presentation: { kind: 'other', title: 'goal', goal: { phase: 'completed', summary: 'not authority' } } }));
    expect(h.messages()[0]?.outcome).toBe('failed');
    let foreground = reduceForegroundRun(initialForegroundRunState(), { type: 'begin-reconcile', generation: 1 }, 'session-1');
    foreground = reduceForegroundRun(foreground, { type: 'run-updated', run: { ...run, status: 'running' } }, 'session-1');
    expect(foreground).toMatchObject({ kind: 'active', runId: 'r1' });
    foreground = applyHostPushToForeground(foreground, { type: 'run/terminal', run }, 'session-1');
    expect(foreground).toMatchObject({ kind: 'idle' });
    expect(applyHostPushToForeground(foreground, { type: 'run/updated', run: { ...run, sessionId: 'foreign', status: 'running' } }, 'session-1')).toEqual(foreground);
    expect(applyHostPushToForeground(foreground, { type: 'run/terminal', run: { ...run, sessionId: 'foreign' } }, 'session-1')).toEqual(foreground);
    expect(applyHostPushToForeground(foreground, pushEvent({ type: 'tool/start', toolCallId: 'g2', toolName: 'goal_complete', responseMessageId: 'm1', presentation: { kind: 'other', title: 'goal', goal: { phase: 'completed', summary: 'not authority' } } }), 'session-1')).toEqual(foreground);
    expect(applyHostPushToForeground(foreground, { type: 'run/updated', run: { ...run, runId: 'r2', rootRunId: 'r2', status: 'running' } }, 'session-1')).toMatchObject({ kind: 'active', runId: 'r2' });
  });
});

describe('session/context-updated', () => {
  it('ignores occupancy pushes and does not invent transcript usage', () => {
    const harness = collectMessages();
    handleRemotePush(
      {
        type: 'session/context-updated',
        sessionId: 'session-1',
        snapshot: {
          sessionId: 'session-1',
          revision: 2,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          responseEvidence: {
            currentRunHasResponse: true,
            historyHasDisplayableResponse: true,
          },
          phase: 'idle',
          occupancy: {
            kind: 'known',
            tokensUsed: 90_000,
            quality: 'measured',
            coverage: 'complete',
            basis: 'test',
            sampledAt: '2026-08-30T00:00:00.000Z',
          },
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      },
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()).toEqual([]);
  });
});
