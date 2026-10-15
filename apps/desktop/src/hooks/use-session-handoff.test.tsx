// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionHandoffData } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { pushError } from '../notification-queue';
import { useSessionHandoff, type UseSessionHandoffArgs } from './use-session-handoff';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const handoffData: SessionHandoffData = {
  sessionId: 'next',
  sourceSessionId: 'prev',
  session: {
    id: 'next',
    scope: { kind: 'general' },
    workingDirectory: '/tmp',
    name: 'Handoff · Auth',
  } as SessionHandoffData['session'],
  origin: { kind: 'handoff', sourceSessionId: 'prev', createdAt: '2026-10-15T00:00:00.000Z' },
  contextRef: {
    kind: 'session-handoff',
    sessionId: 'next',
    sourceSessionId: 'prev',
    label: 'Handoff summary',
  },
  summaryChars: 42,
};

describe('useSessionHandoff', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderHook(overrides: Partial<UseSessionHandoffArgs>) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let handoff: ((sessionId: string) => Promise<void>) | undefined;
    const args: UseSessionHandoffArgs = {
      hostClient: { request: vi.fn() } as unknown as HostClient,
      state: { activeSessionId: 'prev', transcriptOwnerSessionId: 'prev' },
      dispatch: vi.fn(),
      dispatchNotification: vi.fn(),
      handleResumeSession: vi.fn(async () => undefined),
      seedSessionContextRefs: vi.fn(),
      ...overrides,
    };
    function Harness(): null {
      handoff = useSessionHandoff(args).handleHandoffSession;
      return null;
    }
    act(() => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <Harness />
        </DesktopLocaleProvider>,
      );
    });
    if (handoff === undefined) throw new Error('hook did not render');
    return { handoff, args };
  }

  it('parks the summary chip on the new session before switching to it, sending nothing', async () => {
    const order: string[] = [];
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      order.push(command.type);
      return {
        id: 'r1',
        type: 'response',
        command: command.type,
        success: true,
        data: handoffData,
      };
    });
    const { handoff, args } = renderHook({
      hostClient: { request } as unknown as HostClient,
      seedSessionContextRefs: vi.fn(() => order.push('seed')),
      handleResumeSession: vi.fn(async () => {
        order.push('resume');
      }),
    });

    await act(async () => handoff('prev'));

    expect(request).toHaveBeenCalledWith({ type: 'session/handoff', sessionId: 'prev' });
    expect(args.seedSessionContextRefs).toHaveBeenCalledWith('next', [
      { kind: 'session-handoff', sessionId: 'next', sourceSessionId: 'prev', label: '交接摘要' },
    ]);
    expect(args.handleResumeSession).toHaveBeenCalledWith('next');
    // Seeding after the switch would be wiped by the session snapshot restore.
    expect(order).toEqual(['session/handoff', 'seed', 'resume']);
    expect(order).not.toContain('session/prompt');
  });

  it('reports a rejected request and lets the user retry', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Host connection lost'))
      .mockResolvedValueOnce({
        type: 'response',
        command: 'session/handoff',
        success: true,
        data: handoffData,
      });
    const { handoff, args } = renderHook({ hostClient: { request } as unknown as HostClient });

    await act(async () => handoff('prev'));

    expect(args.dispatchNotification).toHaveBeenLastCalledWith(pushError('Host connection lost'));
    expect(args.handleResumeSession).not.toHaveBeenCalled();
    await act(async () => handoff('prev'));
    expect(args.handleResumeSession).toHaveBeenCalledWith('next');
  });

  it('ignores duplicate clicks while the summary is being generated', async () => {
    let complete: ((response: HostResponse) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<HostResponse>((resolve) => {
          complete = resolve;
        }),
    );
    const { handoff } = renderHook({ hostClient: { request } as unknown as HostClient });
    const first = handoff('prev');
    await handoff('prev');
    expect(request).toHaveBeenCalledTimes(1);
    if (!complete) throw new Error('request did not start');
    await act(async () => {
      complete?.({
        type: 'response',
        command: 'session/handoff',
        success: true,
        data: handoffData,
      });
      await first;
    });
  });

  it('stays put and reports the Host error when the handoff fails', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      id: 'r1',
      type: 'response',
      command: 'session/handoff',
      success: false,
      error: 'Session has no messages to summarize',
    }));
    const { handoff, args } = renderHook({ hostClient: { request } as unknown as HostClient });

    await act(async () => handoff('prev'));

    expect(args.seedSessionContextRefs).not.toHaveBeenCalled();
    expect(args.handleResumeSession).not.toHaveBeenCalled();
    expect(args.dispatchNotification).toHaveBeenLastCalledWith(
      pushError('Session has no messages to summarize'),
    );
  });
});
