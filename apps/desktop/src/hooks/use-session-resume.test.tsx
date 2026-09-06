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

describe('useSessionResume continue-in-project', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const projectPath = '/Volumes/BigDisk/Projects/Projects/piwin';
  const continuedId = 'session-continued';

  function projectResumeData(sessionId: string) {
    return {
      sessionId,
      live: false,
      scope: { kind: 'project' as const, projectPath },
      name: 'Continued session',
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          text: 'hello',
          createdAt: '2026-08-31T12:00:00.000Z',
          status: 'done' as const,
        },
      ],
    };
  }

  function renderContinueHook(input: {
    hostClient: HostClient;
    dispatch?: ReturnType<typeof vi.fn>;
  }): { latest: () => ResumeHook; dispatch: ReturnType<typeof vi.fn> } {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = input.dispatch ?? vi.fn();
    const hydrateSessions = vi.fn(async () => []);
    const state: ChatUiState = {
      ...createInitialChatUiState(),
      activeScope: { kind: 'general' },
      generalSessions: [sessionItem('session-old')],
      sessions: [sessionItem('session-old')],
    };
    let captured: ResumeHook | undefined;
    function Harness(): null {
      captured = useSessionResume({
        hostClient: input.hostClient,
        state,
        dispatch: dispatch as (action: ChatUiAction) => void,
        dispatchNotification: vi.fn(),
        locale: 'en',
        showArchivedSessions: false,
        hydrateSessions,
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

  function liveHost(
    request: (command: HostCommand) => Promise<HostResponse>,
  ): HostClient {
    return {
      getHostInstanceId: () => 'host-1',
      getTransport: () => 'live',
      isReady: () => true,
      request,
    } as unknown as HostClient;
  }

  it('activates the destination project before resume and sets the session once', async () => {
    const commands: string[] = [];
    const hostClient = liveHost(async (command) => {
      commands.push(command.type);
      if (command.type === 'project/open') {
        return ok(command, { path: projectPath, trusted: true, trust: 'trusted' });
      }
      if (command.type === 'session/resume') {
        return ok(command, projectResumeData(continuedId));
      }
      if (command.type === 'session/queued-turn-list') {
        return ok(command, { queueRevision: 0, queuedTurns: [] });
      }
      if (command.type === 'session/list-children') {
        return ok(command, { sessions: [], invocations: [] });
      }
      return ok(command);
    });
    const { latest, dispatch } = renderContinueHook({ hostClient });

    await act(async () => {
      await latest().handleResumeSession(continuedId, {
        scope: { kind: 'project', projectPath },
      });
    });

    expect(commands.indexOf('project/open')).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('project/open')).toBeLessThan(commands.indexOf('session/resume'));
    const sessionSets = dispatch.mock.calls.filter(
      (call) => (call[0] as ChatUiAction).type === 'session/set',
    );
    expect(sessionSets).toHaveLength(1);
    expect(sessionSets[0]?.[0]).toEqual({
      type: 'session/set',
      sessionId: continuedId,
      awaitTranscript: true,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/set', path: projectPath, trusted: true }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/load-messages',
        sessionId: continuedId,
      }),
    );
  });

  it('selects the session before project activation and does not wait on list hydrate', async () => {
    let releaseOpen: (() => void) | undefined;
    const hydrateSessions = vi.fn(async () => []);
    const hostClient = liveHost(async (command) => {
      if (command.type === 'project/open') {
        await new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
        return ok(command, { path: projectPath, trusted: true, trust: 'trusted' });
      }
      if (command.type === 'session/resume') {
        return ok(command, projectResumeData(continuedId));
      }
      if (command.type === 'session/queued-turn-list') {
        return ok(command, { queueRevision: 0, queuedTurns: [] });
      }
      if (command.type === 'session/list-children') {
        return ok(command, { sessions: [], invocations: [] });
      }
      return ok(command);
    });
    const dispatch = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const state: ChatUiState = {
      ...createInitialChatUiState(),
      activeScope: { kind: 'general' },
      generalSessions: [sessionItem('session-old')],
      sessions: [sessionItem('session-old')],
    };
    let captured: ResumeHook | undefined;
    function Harness(): null {
      captured = useSessionResume({
        hostClient,
        state,
        dispatch: dispatch as (action: ChatUiAction) => void,
        dispatchNotification: vi.fn(),
        locale: 'en',
        showArchivedSessions: false,
        hydrateSessions,
      });
      return null;
    }
    act(() => {
      root?.render(<Harness />);
    });

    let finished: Promise<void> | undefined;
    act(() => {
      finished = captured?.handleResumeSession(continuedId, {
        scope: { kind: 'project', projectPath },
      });
    });
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: 'session/set',
        sessionId: continuedId,
        awaitTranscript: true,
      });
    });
    expect(dispatch.mock.calls.some((call) => (call[0] as ChatUiAction).type === 'project/set')).toBe(
      false,
    );

    await act(async () => {
      releaseOpen?.();
      await finished;
    });

    expect(hydrateSessions).toHaveBeenCalled();
    const projectSets = dispatch.mock.calls.filter(
      (call) => (call[0] as ChatUiAction).type === 'project/set',
    );
    expect(projectSets[0]?.[0]).toEqual({
      type: 'project/set',
      path: projectPath,
      trusted: true,
      keepActiveSession: true,
    });
  });

  it('does not resume again when the same loaded session is clicked', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'session/resume') {
        return ok(command, resumeSuccessData('session-old'));
      }
      return ok(command);
    });
    const hostClient = {
      getHostInstanceId: () => 'host-1',
      getTransport: () => 'live',
      isReady: () => true,
      request,
    } as unknown as HostClient;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    const state: ChatUiState = {
      ...chatState(),
      activeSessionId: 'session-old',
      transcriptOwnerSessionId: 'session-old',
      awaitingTranscript: false,
    };
    let captured: ResumeHook | undefined;
    function Harness(): null {
      captured = useSessionResume({
        hostClient,
        state,
        dispatch: dispatch as (action: ChatUiAction) => void,
        dispatchNotification: vi.fn(),
        locale: 'en',
        showArchivedSessions: false,
        hydrateSessions: vi.fn(async () => []),
      });
      return null;
    }
    act(() => {
      root?.render(<Harness />);
    });

    await act(async () => {
      await captured?.handleResumeSession('session-old');
    });

    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session/resume' }));
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/set', sessionId: 'session-old' }),
    );
  });

  it('does not re-set the same session after discovering project scope from resume', async () => {
    const hostClient = liveHost(async (command) => {
      if (command.type === 'project/open') {
        return ok(command, { path: projectPath, trusted: true, trust: 'trusted' });
      }
      if (command.type === 'session/resume') {
        return ok(command, projectResumeData(continuedId));
      }
      if (command.type === 'session/queued-turn-list') {
        return ok(command, { queueRevision: 0, queuedTurns: [] });
      }
      if (command.type === 'session/list-children') {
        return ok(command, { sessions: [], invocations: [] });
      }
      return ok(command);
    });
    const { latest, dispatch } = renderContinueHook({ hostClient });

    await act(async () => {
      await latest().handleResumeSession(continuedId);
    });

    const sessionSets = dispatch.mock.calls.filter(
      (call) => (call[0] as ChatUiAction).type === 'session/set',
    );
    expect(sessionSets).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/set', path: projectPath, trusted: true }),
    );
  });
});
