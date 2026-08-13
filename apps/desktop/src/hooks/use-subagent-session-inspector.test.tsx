// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, SessionSummary, SessionTranscriptMessage } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { SubagentStreamState } from '../chat-reducer';
import {
  useSubagentSessionInspector,
  type SubagentInspectorController,
} from './use-subagent-session-inspector';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type DeferredCall = {
  command: unknown;
  resolve: (response: HostResponse) => void;
  reject: (error: Error) => void;
};

function createDeferredHostClient(): {
  hostClient: HostClient;
  calls: DeferredCall[];
  requestMock: ReturnType<typeof vi.fn>;
} {
  const calls: DeferredCall[] = [];
  const requestMock = vi.fn((command: unknown) => {
    return new Promise<HostResponse>((resolve, reject) => {
      calls.push({ command, resolve, reject });
    });
  });
  return { hostClient: { request: requestMock } as unknown as HostClient, calls, requestMock };
}

function resolveWith(call: DeferredCall, messages: SessionTranscriptMessage[]): void {
  call.resolve({
    type: 'response',
    command: 'session/messages',
    success: true,
    data: { sessionId: (call.command as { sessionId?: string }).sessionId ?? '', messages },
  });
}

function failWith(call: DeferredCall, error: string): void {
  call.resolve({ type: 'response', command: 'session/messages', success: false, error });
}

function makeMessage(id: string, text: string): SessionTranscriptMessage {
  return {
    id,
    role: 'assistant',
    text,
    createdAt: '2026-08-03T00:00:00.000Z',
    status: 'done',
  };
}

function makeChild(summary: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    scope: { kind: 'project', projectPath: '/workspace' },
    workingDirectory: '/workspace',
    projectPath: '/workspace',
    updatedAt: '2026-08-03T00:00:00.000Z',
    messageCount: 0,
    parentSessionId: 'parent-1',
    kind: 'subagent',
    ...summary,
  };
}

function makeStream(overrides: Partial<SubagentStreamState>): SubagentStreamState {
  return {
    childSessionId: 'child-1',
    completedSegments: [],
    completionRevision: 0,
    text: '',
    thinking: '',
    tools: [],
    streaming: true,
    currentMessageId: 'assistant-1',
    ...overrides,
  };
}

function makeSegment(messageId: string, text: string) {
  return { messageId, text, thinking: '', tools: [] };
}

function renderInspector(options: {
  hostClient: HostClient;
  streamFor?: (childSessionId: string) => SubagentStreamState | undefined;
  childFor?: (childSessionId: string) => SessionSummary | undefined;
  onOpenFullSession?: (sessionId: string) => void;
}): {
  root: Root;
  container: HTMLElement;
  capture: () => SubagentInspectorController;
  rerender: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: SubagentInspectorController | null = null;
  let bumpRender: (() => void) | undefined;

  function Harness(): null {
    const [, setTick] = useState(0);
    bumpRender = () => setTick((current) => current + 1);
    const controller = useSubagentSessionInspector({
      hostClient: options.hostClient,
      streamFor: options.streamFor ?? (() => undefined),
      childFor: options.childFor ?? (() => undefined),
      onOpenFullSession: options.onOpenFullSession ?? (() => {}),
    });
    latest = controller;
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  const capture = (): SubagentInspectorController => {
    if (latest === null) {
      throw new Error('Inspector controller was not captured.');
    }
    return latest;
  };

  const rerender = (): void => {
    if (bumpRender === undefined) {
      throw new Error('Harness render tick is unavailable.');
    }
    const bump = bumpRender;
    act(() => {
      bump();
    });
  };

  return { root, container, capture, rerender };
}

function dispose(root: Root, container: HTMLElement): void {
  act(() => {
    root.unmount();
  });
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

describe('useSubagentSessionInspector', () => {
  it('loads persisted history when the inspector is opened', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    const harness = renderInspector({ hostClient });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'Explorer',
        taskSummary: 'Find the bug',
      });
    });

    const openCall = calls.at(-1);
    expect(openCall?.command).toMatchObject({
      type: 'session/messages',
      sessionId: 'child-1',
    });
    expect(harness.capture().loading).toBe(true);

    await act(async () => {
      if (openCall) {
        resolveWith(openCall, [makeMessage('assistant-1', 'Found it')]);
      }
      await Promise.resolve();
    });

    expect(harness.capture().loading).toBe(false);
    expect(harness.capture().error).toBeNull();
    expect(harness.capture().messages.map((message) => message.text)).toEqual(['Found it']);
    dispose(harness.root, harness.container);
  });

  it('ignores a stale response after opening another child', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    const harness = renderInspector({ hostClient });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task one',
      });
    });
    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-2',
        displayName: 'Two',
        taskSummary: 'Task two',
      });
    });

    const firstCall = calls[0];
    const secondCall = calls[1];
    expect(secondCall?.command).toMatchObject({ sessionId: 'child-2' });

    await act(async () => {
      if (firstCall) {
        resolveWith(firstCall, [makeMessage('stale', 'from child one')]);
      }
      await Promise.resolve();
    });

    // The late response for child-1 must not land in the current view.
    expect(harness.capture().messages).toEqual([]);

    await act(async () => {
      if (secondCall) {
        resolveWith(secondCall, [makeMessage('fresh', 'from child two')]);
      }
      await Promise.resolve();
    });

    expect(harness.capture().messages.map((message) => message.text)).toEqual([
      'from child two',
    ]);
    dispose(harness.root, harness.container);
  });

  it('ignores the response when the inspector closes during the request', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    const harness = renderInspector({ hostClient });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });
    act(() => {
      harness.capture().closeInspector();
    });

    const openCall = calls[0];
    await act(async () => {
      if (openCall) {
        resolveWith(openCall, [makeMessage('late', 'should be dropped')]);
      }
      await Promise.resolve();
    });

    expect(harness.capture().selection).toBeNull();
    expect(harness.capture().messages).toEqual([]);
    expect(harness.capture().loading).toBe(false);
    dispose(harness.root, harness.container);
  });

  it('surfaces a retryable load error and retries on demand', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    const harness = renderInspector({ hostClient });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });

    const firstCall = calls[0];
    await act(async () => {
      if (firstCall) {
        failWith(firstCall, 'transcript store unavailable');
      }
      await Promise.resolve();
    });

    expect(harness.capture().error).toContain('transcript store unavailable');

    act(() => {
      harness.capture().retryLoad();
    });
    const retryCall = calls[1];
    expect(retryCall?.command).toMatchObject({ sessionId: 'child-1' });

    await act(async () => {
      if (retryCall) {
        resolveWith(retryCall, [makeMessage('recovered', 'content')]);
      }
      await Promise.resolve();
    });

    expect(harness.capture().error).toBeNull();
    expect(harness.capture().messages.map((message) => message.text)).toEqual(['content']);
    dispose(harness.root, harness.container);
  });

  it('refreshes persisted history once when the live stream becomes terminal', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    let liveStream: SubagentStreamState | undefined = undefined;
    const harness = renderInspector({
      hostClient,
      streamFor: (childSessionId) =>
        childSessionId === 'child-1' ? liveStream : undefined,
    });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });

    const openCall = calls[0];
    await act(async () => {
      if (openCall) {
        resolveWith(openCall, [makeMessage('user-1', 'task prompt')]);
      }
      await Promise.resolve();
    });
    expect(harness.capture().status).toBe('running');

    // Stream starts live with a current message, then becomes terminal.
    liveStream = makeStream({ streaming: true });
    harness.rerender();
    expect(harness.capture().liveTail).not.toBeNull();

    liveStream = { ...makeStream({ streaming: false, text: 'final answer' }) };
    harness.rerender();

    // The terminal transition triggers exactly one reload.
    const refreshCall = calls[1];
    expect(refreshCall?.command).toMatchObject({ sessionId: 'child-1' });
    await act(async () => {
      if (refreshCall) {
        resolveWith(refreshCall, [
          makeMessage('user-1', 'task prompt'),
          makeMessage('assistant-1', 'final answer'),
        ]);
      }
      await Promise.resolve();
    });

    // Terminal stream is dropped once history includes the final message id.
    expect(harness.capture().messages.map((message) => message.text)).toEqual([
      'task prompt',
      'final answer',
    ]);
    expect(harness.capture().liveTail).toBeNull();
    dispose(harness.root, harness.container);
  });

  it('refreshes history for every completed message while the dialog stays open', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    let liveStream: SubagentStreamState | undefined = undefined;
    const harness = renderInspector({
      hostClient,
      streamFor: (childSessionId) => (childSessionId === 'child-1' ? liveStream : undefined),
    });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });
    const openCall = calls[0];
    await act(async () => {
      if (openCall) {
        resolveWith(openCall, [makeMessage('user-1', 'task prompt')]);
      }
      await Promise.resolve();
    });

    // First message completes → one refresh.
    liveStream = makeStream({
      streaming: false,
      currentMessageId: null,
      completedSegments: [makeSegment('m1', 'first answer')],
      completionRevision: 1,
    });
    harness.rerender();
    expect(calls).toHaveLength(2);
    await act(async () => {
      const refresh = calls[1];
      if (refresh) {
        resolveWith(refresh, [
          makeMessage('user-1', 'task prompt'),
          makeMessage('m1', 'first answer'),
        ]);
      }
      await Promise.resolve();
    });

    // Second message streams: no refresh while live.
    liveStream = makeStream({
      streaming: true,
      currentMessageId: 'm2',
      text: 'second in flight',
      completedSegments: [makeSegment('m1', 'first answer')],
      completionRevision: 1,
    });
    harness.rerender();
    expect(calls).toHaveLength(2);

    // Second message completes → the dialog must refresh again, not once per child.
    liveStream = makeStream({
      streaming: false,
      currentMessageId: null,
      completedSegments: [makeSegment('m1', 'first answer'), makeSegment('m2', 'second answer')],
      completionRevision: 2,
    });
    harness.rerender();
    expect(calls).toHaveLength(3);
    await act(async () => {
      const refresh = calls[2];
      if (refresh) {
        resolveWith(refresh, [
          makeMessage('user-1', 'task prompt'),
          makeMessage('m1', 'first answer'),
          makeMessage('m2', 'second answer'),
        ]);
      }
      await Promise.resolve();
    });

    expect(harness.capture().messages.map((message) => message.text)).toEqual([
      'task prompt',
      'first answer',
      'second answer',
    ]);
    expect(harness.capture().liveTail).toBeNull();
    dispose(harness.root, harness.container);
  });

  it('still refreshes history after 30 completed segments', async () => {
    const { hostClient, calls } = createDeferredHostClient();
    let liveStream: SubagentStreamState | undefined = undefined;
    const harness = renderInspector({
      hostClient,
      streamFor: (childSessionId) => (childSessionId === 'child-1' ? liveStream : undefined),
    });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });
    const openCall = calls[0];
    await act(async () => {
      if (openCall) {
        resolveWith(openCall, [makeMessage('user-1', 'task prompt')]);
      }
      await Promise.resolve();
    });

    const thirtySegments = Array.from({ length: 30 }, (_, index) =>
      makeSegment(`m${index + 1}`, `answer ${index + 1}`),
    );
    liveStream = makeStream({
      streaming: false,
      currentMessageId: null,
      completedSegments: thirtySegments,
      completionRevision: 30,
    });
    harness.rerender();
    expect(calls).toHaveLength(2);
    await act(async () => {
      const refresh = calls[1];
      if (refresh) {
        resolveWith(refresh, [
          makeMessage('user-1', 'task prompt'),
          ...thirtySegments.map((segment) => makeMessage(segment.messageId, segment.text)),
        ]);
      }
      await Promise.resolve();
    });

    liveStream = makeStream({
      streaming: false,
      currentMessageId: null,
      completedSegments: [...thirtySegments.slice(1), makeSegment('m31', 'answer 31')],
      completionRevision: 31,
    });
    harness.rerender();
    expect(calls).toHaveLength(3);

    liveStream = makeStream({
      streaming: false,
      currentMessageId: null,
      completedSegments: [
        ...thirtySegments.slice(2),
        makeSegment('m31', 'answer 31'),
        makeSegment('m32', 'answer 32'),
      ],
      completionRevision: 32,
    });
    harness.rerender();
    expect(calls).toHaveLength(4);

    dispose(harness.root, harness.container);
  });

  it('derives status from the live stream before the child summary', () => {
    const { hostClient } = createDeferredHostClient();
    const harness = renderInspector({
      hostClient,
      streamFor: () => makeStream({ streaming: true }),
      childFor: (id) => (id === 'child-1' ? makeChild({ id: 'child-1', subagentStatus: 'done' }) : undefined),
    });

    act(() => {
      harness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });
    expect(harness.capture().status).toBe('running');

    // Silent stream falls back to the child summary.
    const silentHarness = renderInspector({
      hostClient,
      streamFor: () => makeStream({ streaming: false }),
      childFor: (id) => (id === 'child-1' ? makeChild({ id: 'child-1', subagentStatus: 'done' }) : undefined),
    });
    act(() => {
      silentHarness.capture().openInspector({
        childSessionId: 'child-1',
        displayName: 'One',
        taskSummary: 'Task',
      });
    });
    expect(silentHarness.capture().status).toBe('completed');
    dispose(harness.root, harness.container);
    dispose(silentHarness.root, silentHarness.container);
  });
});
