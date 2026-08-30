// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialChatUiState, type ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ComposerMediaResult = ReturnType<typeof useComposerMedia>;

describe('resumeDraft bumps the session resume guard', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('calls onLeaveActiveSession before clearing the active session', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = { request: vi.fn() } as unknown as HostClient;
    const dispatch = vi.fn();
    const onLeaveActiveSession = vi.fn();
    let captured: ComposerMediaResult | undefined;

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
        onLeaveActiveSession,
      });
      return null;
    }

    const latest = (): ComposerMediaResult => {
      if (captured === undefined) {
        throw new Error('useComposerMedia was not rendered');
      }
      return captured;
    };

    const draftState = { ...createInitialChatUiState(), activeSessionId: null };
    const sessionState = { ...draftState, activeSessionId: 'session-a' };

    act(() => root?.render(<Harness state={draftState} />));
    act(() => latest().setComposer('parked draft for New'));
    const draftId = latest().draftSessions[0]?.id;
    expect(draftId).toBeDefined();

    act(() => root?.render(<Harness state={sessionState} />));
    act(() => latest().resumeDraft(draftId ?? 'missing-draft'));

    expect(onLeaveActiveSession).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ type: 'session/clear-active' });
    const leaveOrder = onLeaveActiveSession.mock.invocationCallOrder[0];
    const clearIndex = dispatch.mock.calls.findIndex(
      (call) => (call[0] as { type?: string } | undefined)?.type === 'session/clear-active',
    );
    const clearOrder = dispatch.mock.invocationCallOrder[clearIndex];
    if (leaveOrder === undefined || clearOrder === undefined) {
      throw new Error('expected onLeaveActiveSession to run before session/clear-active');
    }
    expect(leaveOrder).toBeLessThan(clearOrder);
  });
});
