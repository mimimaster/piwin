// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionHandoffData } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushInfo } from '../notification-queue';
import {
  handoffProgressNotificationId,
  useSessionHandoff,
  type StartSessionHandoff,
  type UseSessionHandoffArgs,
} from './use-session-handoff';

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

function okResponse(command: string, data?: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

function refused(reason: string): HostResponse {
  return {
    type: 'response',
    command: 'session/handoff',
    success: false,
    error: 'refused',
    problem: { code: 'session-handoff-refused', data: { reason } },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

function pushedNotifications(dispatchNotification: unknown) {
  return (dispatchNotification as ReturnType<typeof vi.fn>).mock.calls
    .map(([action]) => action as NotificationAction)
    .filter((action): action is Extract<NotificationAction, { type: 'notify/push' }> =>
      action.type === 'notify/push',
    )
    .map((action) => action.notification);
}

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
    let start: StartSessionHandoff | undefined;
    let args: UseSessionHandoffArgs = {
      hostClient: { request: vi.fn() } as unknown as HostClient,
      state: { activeSessionId: 'prev', transcriptOwnerSessionId: 'prev' },
      dispatch: vi.fn(),
      dispatchNotification: vi.fn(),
      handleResumeSession: vi.fn(async () => undefined),
      seedSessionContextRefs: vi.fn(),
      ...overrides,
    };
    function Harness(): null {
      start = useSessionHandoff(args).startHandoff;
      return null;
    }
    const render = () =>
      act(() => {
        root?.render(
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
            <Harness />
          </DesktopLocaleProvider>,
        );
      });
    render();
    return {
      start: (sessionId: string, instructions?: string) => {
        if (start === undefined) throw new Error('hook did not render');
        return start(sessionId, instructions ? { instructions } : undefined);
      },
      args,
      switchTo: (sessionId: string) => {
        args = { ...args, state: { activeSessionId: sessionId, transcriptOwnerSessionId: sessionId } };
        render();
      },
    };
  }

  it('parks the summary chip on the new session before switching to it, sending nothing', async () => {
    const order: string[] = [];
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      order.push(command.type);
      return okResponse(command.type, handoffData);
    });
    const { start, args } = renderHook({
      hostClient: { request } as unknown as HostClient,
      seedSessionContextRefs: vi.fn(() => order.push('seed')),
      handleResumeSession: vi.fn(async () => {
        order.push('resume');
      }),
    });

    expect(start('prev')).toBe(true);
    await settle();

    expect(request).toHaveBeenCalledWith({ type: 'session/handoff', sessionId: 'prev' });
    expect(args.seedSessionContextRefs).toHaveBeenCalledWith('next', [
      { kind: 'session-handoff', sessionId: 'next', sourceSessionId: 'prev', label: '交接摘要' },
    ]);
    expect(args.handleResumeSession).toHaveBeenCalledWith('next');
    // Seeding after the switch would be wiped by the session snapshot restore.
    expect(order).toEqual(['session/handoff', 'seed', 'resume']);
    expect(order).not.toContain('session/prompt');
    expect(args.dispatchNotification).toHaveBeenCalledWith({
      type: 'notify/dismiss',
      id: handoffProgressNotificationId('prev'),
    });
  });

  it('passes the focus instructions to the Host', async () => {
    const request = vi.fn(async (command: HostCommand) => okResponse(command.type, handoffData));
    const { start } = renderHook({ hostClient: { request } as unknown as HostClient });

    start('prev', '  only the auth refactor ');
    await settle();

    expect(request).toHaveBeenCalledWith({
      type: 'session/handoff',
      sessionId: 'prev',
      instructions: 'only the auth refactor',
    });
  });

  it('shows a sticky progress toast whose cancel aborts the summary', async () => {
    let complete: ((response: HostResponse) => void) | undefined;
    const request = vi.fn((command: HostCommand) =>
      command.type === 'session/handoff'
        ? new Promise<HostResponse>((resolve) => {
            complete = resolve;
          })
        : Promise.resolve(okResponse(command.type)),
    );
    const { start, args } = renderHook({ hostClient: { request } as unknown as HostClient });

    start('prev');
    await settle();
    const progress = pushedNotifications(args.dispatchNotification)[0];
    expect(progress).toMatchObject({ id: handoffProgressNotificationId('prev'), ttlMs: 0 });
    expect(progress?.action?.label).toBe('取消');

    progress?.action?.onClick();
    await settle();
    expect(request).toHaveBeenCalledWith({ type: 'session/compact-abort', sessionId: 'prev' });

    complete?.(refused('cancelled'));
    await settle();
    expect(args.dispatchNotification).toHaveBeenLastCalledWith(pushInfo('已取消交接'));
    expect(args.seedSessionContextRefs).not.toHaveBeenCalled();
  });

  it('does not yank the user away when they moved to another session meanwhile', async () => {
    let complete: ((response: HostResponse) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<HostResponse>((resolve) => {
          complete = resolve;
        }),
    );
    const { start, args, switchTo } = renderHook({ hostClient: { request } as unknown as HostClient });

    start('prev');
    await settle();
    switchTo('other');
    complete?.(okResponse('session/handoff', handoffData));
    await settle();

    expect(args.seedSessionContextRefs).toHaveBeenCalledWith('next', expect.any(Array));
    expect(args.handleResumeSession).not.toHaveBeenCalled();
    const ready = pushedNotifications(args.dispatchNotification).at(-1);
    expect(ready).toMatchObject({ level: 'success', message: '交接摘要已生成：「Handoff · Auth」' });
    ready?.action?.onClick();
    expect(args.handleResumeSession).toHaveBeenCalledWith('next');
  });

  it('reports a rejected request and lets the user retry', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Host connection lost'))
      .mockResolvedValueOnce(okResponse('session/handoff', handoffData));
    const { start, args } = renderHook({ hostClient: { request } as unknown as HostClient });

    start('prev');
    await settle();

    expect(args.dispatchNotification).toHaveBeenLastCalledWith(pushError('Host connection lost'));
    expect(args.handleResumeSession).not.toHaveBeenCalled();
    start('prev');
    await settle();
    expect(args.handleResumeSession).toHaveBeenCalledWith('next');
  });

  it('refuses a second handoff of the same session while the first is running', async () => {
    let complete: ((response: HostResponse) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<HostResponse>((resolve) => {
          complete = resolve;
        }),
    );
    const { start } = renderHook({ hostClient: { request } as unknown as HostClient });
    expect(start('prev')).toBe(true);
    expect(start('prev')).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    complete?.(okResponse('session/handoff', handoffData));
    await settle();
  });

  it('stays put and explains an empty session in the user language', async () => {
    const request = vi.fn(async () => refused('empty-transcript'));
    const { start, args } = renderHook({ hostClient: { request } as unknown as HostClient });

    start('prev');
    await settle();

    expect(args.seedSessionContextRefs).not.toHaveBeenCalled();
    expect(args.handleResumeSession).not.toHaveBeenCalled();
    expect(args.dispatchNotification).toHaveBeenLastCalledWith(
      pushError('这个会话还没有对话，没有可交接的内容。'),
    );
  });
});
