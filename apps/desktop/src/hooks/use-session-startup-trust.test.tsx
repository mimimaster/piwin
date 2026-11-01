// @vitest-environment happy-dom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionScope } from '@piwin/contracts';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatUiAction,
  type ChatUiState,
} from '../conversation/chat-reducer.js';
import type { HostClient } from '../host/host-client.js';
import { sessionCacheHostKey } from '../session/session-cache-host.js';
import {
  buildSessionStartupSnapshot,
  createSessionStartupState,
  writeSessionStartupSnapshot,
} from '../session/session-startup-cache.js';
import { useSessionResume } from './use-session-resume.js';
import { useSessionStartupCache } from './use-session-startup-cache.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('cached project trust refresh', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  const cases = (['live', 'remote'] as const).flatMap((transport) =>
    ([true, false] as const).flatMap((trusted) =>
      ([true, false] as const).map((withScopeHint) => ({ transport, trusted, withScopeHint })),
    ),
  );

  it.each(cases)(
    'rechecks $transport trust=$trusted with scope hint=$withScopeHint without granting trust',
    async ({ transport, trusted, withScopeHint }) => {
      const projectPath = transport === 'remote' ? 'project-0123456789abcdef01234567' : '/project';
      const scope: SessionScope = { kind: 'project', projectPath };
      const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
        let data: unknown = {};
        if (command.type === 'project/open') {
          data = { path: projectPath, trusted, trust: trusted ? 'trusted' : 'untrusted' };
        } else if (command.type === 'project/list') {
          data = {
            projects: [{ projectId: projectPath, trust: trusted ? 'trusted' : 'untrusted' }],
          };
        } else if (command.type === 'session/resume') {
          data = {
            sessionId: 'cached',
            scope,
            messages: [{ id: 'fresh', role: 'assistant', text: 'Fresh from Host', status: 'done' }],
          };
        } else if (command.type === 'session/queued-turn-list') {
          data = { queueRevision: 0, queuedTurns: [] };
        }
        return { type: 'response', command: command.type, success: true, data };
      });
      const hostClient = {
        getTransport: () => transport,
        getRemoteTarget: () => ({ hostId: 'host-a', endpoint: 'ws://test' }),
        getHostInstanceId: () => 'host-1',
        isReady: () => true,
        request,
      } as unknown as HostClient;
      const hostKey = sessionCacheHostKey(hostClient);
      if (hostKey === null) throw new Error('Expected a persistent Host partition');
      writeSessionStartupSnapshot(
        hostKey,
        buildSessionStartupSnapshot({
          ...createInitialChatUiState(),
          activeScope: scope,
          projectPath,
          projectTrusted: true,
          activeSessionId: 'cached',
          transcriptOwnerSessionId: 'cached',
          messages: [
            {
              id: 'saved',
              role: 'assistant',
              text: 'Cached reply',
              thinking: '',
              tools: [],
              attachments: [],
              status: 'done',
            },
          ],
        }),
      );
      let latestState: ChatUiState | undefined;
      let dispatch: ((action: ChatUiAction) => void) | undefined;
      let resume: ReturnType<typeof useSessionResume> | undefined;
      const dispatchNotification = vi.fn();
      function Harness() {
        const [state, send] = useReducer(chatUiReducer, hostClient, createSessionStartupState);
        latestState = state;
        dispatch = send;
        resume = useSessionResume({
          hostClient,
          state,
          dispatch: send,
          dispatchNotification,
          locale: 'en',
          showArchivedSessions: false,
          hydrateSessions: async () => [],
        });
        useSessionStartupCache({
          hostClient,
          state,
          handleResumeSession: withScopeHint ? resume.handleResumeSession : async () => undefined,
        });
        return <span>{state.messages[0]?.text}</span>;
      }
      act(() => root.render(<Harness />));
      expect(container.textContent).toBe('Cached reply');
      expect(latestState?.projectTrusted).toBe(false);
      expect(request).not.toHaveBeenCalled();

      await act(async () => {
        dispatch?.({ type: 'host/status', ready: true, mock: false });
      });
      if (!withScopeHint) {
        await act(async () => {
          await resume?.handleResumeSession('cached', { quiet: true, refresh: true });
        });
      }

      expect(request).toHaveBeenCalledWith(
        transport === 'remote'
          ? { type: 'project/list' }
          : { type: 'project/open', path: projectPath },
      );
      expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'project/trust' }));
      expect(latestState).toMatchObject({
        projectPath,
        projectTrusted: trusted,
        projectTrustPending: false,
        trustDialogOpen: !trusted,
        awaitingTranscript: false,
      });
      expect(container.textContent).toBe('Fresh from Host');
      expect(dispatchNotification).not.toHaveBeenCalled();
    },
  );
});
