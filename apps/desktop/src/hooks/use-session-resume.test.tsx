// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, ModelRef } from '@piwin/contracts';
import { createInitialChatUiState, type ChatUiAction, type ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import {
  makeContextSnapshot,
  makeKnownOccupancy,
} from '../context-telemetry-test-fixtures.js';
import { useSessionResume } from './use-session-resume.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ResumeHook = ReturnType<typeof useSessionResume>;

const oldModel: ModelRef = { providerId: 'openai', modelId: 'gpt-old' };

function ok(command: HostCommand, data: unknown = {}): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

function sessionItem(id: string) {
  return { id, name: id, scope: { kind: 'general' as const } };
}

function chatState(): ChatUiState {
  return {
    ...createInitialChatUiState(),
    sessions: [sessionItem('session-old')],
    generalSessions: [sessionItem('session-old')],
  };
}

function resumeSuccessData(sessionId: string) {
  return {
    sessionId,
    live: true,
    scope: { kind: 'general' as const },
    name: 'Old session',
    model: oldModel,
    thinkingLevel: 'low' as const,
    messages: [],
    contextSnapshot: makeContextSnapshot({
      sessionId,
      revision: 9,
      phase: 'idle',
      occupancy: makeKnownOccupancy({ tokensUsed: 44_000, tokensLimit: 128_000 }),
      responseEvidence: {
        currentRunHasResponse: false,
        historyHasDisplayableResponse: true,
      },
    }),
    lastRequestUsage: null,
  };
}

describe('useSessionResume selection guard', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderHook(input: {
    hostClient: HostClient;
    dispatch?: ReturnType<typeof vi.fn>;
    onProfile?: ReturnType<typeof vi.fn>;
  }): { latest: () => ResumeHook; dispatch: ReturnType<typeof vi.fn> } {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = input.dispatch ?? vi.fn();
    const onProfile = input.onProfile ?? vi.fn();
    let captured: ResumeHook | undefined;
    function Harness(): null {
      captured = useSessionResume({
        hostClient: input.hostClient,
        state: chatState(),
        dispatch: dispatch as (action: ChatUiAction) => void,
        dispatchNotification: vi.fn(),
        locale: 'en',
        showArchivedSessions: false,
        hydrateSessions: vi.fn(async () => []),
        onSessionComposerProfileRestored: onProfile,
      });
      return null;
    }
    act(() => {
      root?.render(<Harness />);
    });
    return {
      dispatch,
      latest: () => {
        if (captured === undefined) {
          throw new Error('useSessionResume was not rendered');
        }
        return captured;
      },
    };
  }

  it('failed resume dispatches telemetry invalidate so occupancy cannot stay visible', async () => {
    const hostClient = {
      getHostInstanceId: () => 'host-1',
      getTransport: () => 'live',
      isReady: () => true,
      request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
        if (command.type === 'session/resume') {
          return {
            type: 'response',
            command: command.type,
            success: false,
            error: 'resume failed',
          };
        }
        return ok(command);
      }),
    } as unknown as HostClient;
    const { latest, dispatch } = renderHook({ hostClient });

    await act(async () => {
      await latest().handleResumeSession('session-old');
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'context-telemetry/invalidate',
      sessionId: 'session-old',
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'context-telemetry/snapshot' }),
    );
  });

  it('New / bumpToDraft blocks late composer-profile and occupancy restore', async () => {
    let resolveResume: ((value: HostResponse) => void) | undefined;
    const hostClient = {
      getHostInstanceId: () => 'host-1',
      getTransport: () => 'live',
      isReady: () => true,
      request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
        if (command.type === 'session/resume') {
          return await new Promise<HostResponse>((resolve) => {
            resolveResume = resolve;
          });
        }
        return ok(command);
      }),
    } as unknown as HostClient;
    const onProfile = vi.fn();
    const { latest, dispatch } = renderHook({ hostClient, onProfile });

    let finished: Promise<void> | undefined;
    act(() => {
      finished = latest().handleResumeSession('session-old');
    });
    await vi.waitFor(() => expect(resolveResume).toBeDefined());

    await act(async () => {
      await latest().handleNewSession();
    });

    act(() => {
      resolveResume?.({
        type: 'response',
        command: 'session/resume',
        success: true,
        data: resumeSuccessData('session-old'),
      });
    });
    await act(async () => {
      await finished;
    });

    expect(onProfile).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'context-telemetry/snapshot' }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/update',
        session: expect.objectContaining({ model: oldModel }),
      }),
    );
  });
});
