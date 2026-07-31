/**
 * Connect host, subscribe to HostServerMessage stream, bootstrap config/theme/pet/status.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  ExtensionUiKind,
  HostPush,
  HostResponse,
  HostServerMessage,
  HostStatusData,
  PiwinConfig,
  SessionPlan,
  ThemeManifest,
} from '@piwin/contracts';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, PermissionPromptUi } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError } from '../notification-queue';
import { appendHostLogEntry, type HostLogEntry } from '../HostLogPanel';
import type { PtyOutputLine } from '../terminal-dock';
import { PIWIN_APPEARANCE_DARK, resolveDesktopAppearance } from '../appearance-tokens';
import { createStreamEventBuffer } from '../stream-event-buffer';

export type ExtensionUiRequestState = {
  sessionId: string;
  requestId: string;
  kind: ExtensionUiKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
};

export type UseHostBootstrapArgs = {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  refreshManagedProcesses: () => Promise<void>;
  appendProcessLog: (processId: string, text: string) => void;
  setPtyOutput: Dispatch<SetStateAction<PtyOutputLine[]>>;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
  /** Root theme owner callback; this hook never applies document theme state itself. */
  onThemeResolved: (theme: ThemeManifest) => void;
};

type PermissionRequestPush = Extract<HostPush, { type: 'permission/request' }>;

export function toPermissionPromptUi(message: PermissionRequestPush): PermissionPromptUi {
  return {
    requestId: message.requestId,
    sessionId: message.sessionId,
    ...(message.runId !== undefined ? { runId: message.runId } : {}),
    action: message.action,
    detail: message.detail,
    defaultDecision: message.defaultDecision,
    ...(message.context ? { context: message.context } : {}),
  };
}

/**
 * Normalize a `theme/get-active` response into the manifest the root theme
 * owner should apply. Built-in piwin ids resolve to the desktop-owned
 * manifest (a stale host copy must not override desktop tokens); failures
 * fall back to built-in dark. Pure so the bootstrap theme path is testable
 * without a HostClient stream.
 */
export function resolveThemeBootstrapResponse(response: HostResponse): ThemeManifest {
  if (!response.success) {
    return PIWIN_APPEARANCE_DARK;
  }
  const themeData = response.data as { theme?: ThemeManifest } | undefined;
  if (themeData?.theme === undefined) {
    return PIWIN_APPEARANCE_DARK;
  }
  return resolveDesktopAppearance(themeData.theme);
}

export function useHostBootstrap(args: UseHostBootstrapArgs) {
  const [hostStatus, setHostStatus] = useState<HostStatusData | null>(null);
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [activePet, setActivePet] = useState<PetRuntimeSnapshot | null>(null);
  const [sessionPlan, setSessionPlan] = useState<SessionPlan | null>(null);
  const [extensionUiRequest, setExtensionUiRequest] = useState<ExtensionUiRequestState | null>(
    null,
  );
  const [extensionUiInput, setExtensionUiInput] = useState('');

  useEffect(() => {
    const { hostClient, dispatch, dispatchNotification } = args;
    const streamEventBuffer = createStreamEventBuffer({ dispatch });
    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'host/status') {
        dispatch({ type: 'host/status', ready: message.ready, mock: message.mock });
        return;
      }
      if (message.type === 'event') {
        streamEventBuffer.push(message.sessionId, message.event, message.envelope);
        if (
          message.event.type === 'process/started' ||
          message.event.type === 'process/updated' ||
          message.event.type === 'process/exited'
        ) {
          void args.refreshManagedProcesses();
        }
        if (message.event.type === 'process/log') {
          const chunk = message.event.chunk;
          args.appendProcessLog(chunk.processId, chunk.text);
        }
        return;
      }
      if (message.type === 'pty/output') {
        args.setPtyOutput((current) => [
          ...current.slice(-999),
          {
            id: `${message.ptyId}:${message.at}:${current.length}`,
            data: message.data,
            at: message.at,
          },
        ]);
        return;
      }
      if (message.type === 'pty/exit') {
        args.setPtyOutput((current) => [
          ...current.slice(-999),
          {
            id: `${message.ptyId}:exit:${current.length}`,
            data: `\n[Shell exited${
              message.exitCode === null || message.exitCode === undefined
                ? ''
                : ` with code ${message.exitCode}`
            }]\n`,
            at: new Date().toISOString(),
          },
        ]);
        return;
      }
      if (message.type === 'transcript/append') {
        dispatch({
          type: 'transcript/append',
          sessionId: message.sessionId,
          message: message.message,
        });
        return;
      }
      if (message.type === 'session/name-updated') {
        // Host auto-named the session; refresh the sidebar row without a full re-list.
        dispatch({
          type: 'session/update',
          session: { id: message.sessionId, name: message.name },
        });
        return;
      }
      if (message.type === 'subagent/stream') {
        dispatch({
          type: 'subagent/stream',
          parentSessionId: message.parentSessionId,
          childSessionId: message.childSessionId,
          event: message.event,
        });
        return;
      }
      if (message.type === 'permission/request') {
        dispatch({
          type: 'permission/show',
          prompt: toPermissionPromptUi(message),
        });
        return;
      }
      if (message.type === 'extension/ui_request') {
        setExtensionUiRequest({
          sessionId: message.sessionId,
          requestId: message.requestId,
          kind: message.kind,
          title: message.title,
          ...(message.message !== undefined ? { message: message.message } : {}),
          ...(message.options !== undefined ? { options: message.options } : {}),
          ...(message.placeholder !== undefined ? { placeholder: message.placeholder } : {}),
        });
        setExtensionUiInput('');
        return;
      }
      if (message.type === 'plan/updated') {
        setSessionPlan(message.plan);
        return;
      }
      if (message.type === 'plan/execution-updated') {
        // Execution state is already embedded in the latest plan/updated push;
        // no separate state update needed here. This handler exists so the
        // push is not logged as unhandled.
        return;
      }
      if (message.type === 'pet/state') {
        setActivePet(message.pet);
        // Forward to the pet overlay window so it can update its sprite
        // without its own host connection.
        void (async () => {
          try {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('pet-state-push', { pet: message.pet });
          } catch {
            // overlay window not open or not in Tauri — ignore
          }
        })();
        return;
      }
      if (message.type === 'host/log') {
        args.setHostLogEntries((current) =>
          appendHostLogEntry(current, {
            level: message.level,
            message: message.message,
            at: new Date().toISOString(),
          }),
        );
        return;
      }
      if (message.type === 'response' && !message.success) {
        // Settings / discovery surface errors in-panel. Do not spam global sticky toasts.
        if (
          message.command === 'models/discover' ||
          message.command === 'config/get' ||
          message.command === 'config/set'
        ) {
          return;
        }
        dispatch({ type: 'error', message: message.error });
        dispatchNotification(pushError(message.error));
      }
    });

    void (async () => {
      try {
        await hostClient.connect();
        const statusResponse = await hostClient.request({ type: 'host/status' });
        if (statusResponse.success) {
          const statusData = statusResponse.data as HostStatusData;
          setHostStatus(statusData);
          // Request path must update the shell pill; push-only left UI stuck offline after HMR.
          dispatch({
            type: 'host/status',
            ready: statusData.ready === true,
            mock: statusData.mock === true,
          });
        } else {
          dispatch({ type: 'host/status', ready: false, mock: false });
        }
      } catch (error) {
        dispatch({ type: 'host/status', ready: false, mock: false });
        dispatchNotification(pushError(error instanceof Error ? error.message : String(error)));
      }
      const configResponse = await hostClient.request({ type: 'config/get' });
      if (configResponse.success) {
        const data = configResponse.data as { config: PiwinConfig };
        setConfig(data.config);
        if (data.config.defaultProviderId && data.config.defaultModelId) {
          args.setSelectedModelKey(
            `${data.config.defaultProviderId}::${data.config.defaultModelId}`,
          );
        }
      }
      const themeResponse = await hostClient.request({ type: 'theme/get-active' });
      // DesktopThemeRoot applies document tokens; this hook only reports.
      args.onThemeResolved(resolveThemeBootstrapResponse(themeResponse));
      const petResponse = await hostClient.request({ type: 'pet/get-active' });
      if (petResponse.success) {
        const petData = petResponse.data as { pet: PetRuntimeSnapshot };
        setActivePet(petData.pet);
      }
    })();

    return () => {
      unsubscribe();
      streamEventBuffer.dispose();
      // Do not dispose the host on React effect re-runs / HMR remounts.
      // Killing the sidecar here races the next connect() and leaves the UI offline
      // while the process map still says "alreadyRunning" or is mid-shutdown.
      // App lifetime owns the HostClient; OS/window close tears down Tauri.
    };
    // Bootstrap once per hostClient instance; setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.hostClient]);

  return {
    hostStatus,
    setHostStatus,
    config,
    setConfig,
    activePet,
    setActivePet,
    sessionPlan,
    setSessionPlan,
    extensionUiRequest,
    setExtensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
  };
}
