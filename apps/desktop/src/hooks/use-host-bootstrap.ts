/**
 * Connect host, subscribe to HostServerMessage stream, bootstrap config/theme/pet/status.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  ConfiguredChatModelsData,
  ExtensionDeploymentRecord,
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
import { formatError, parseSessionContextSnapshot } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { isRemoteCommandGapError } from '../remote-command-gap.js';
import { isWorkbenchHostTeardownError } from '../workbench-host-teardown.js';
import type { ChatUiAction, PermissionPromptUi } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { appendHostLogEntry, type HostLogEntry } from '../HostLogPanel';
import type { PtyOutputLine } from '../terminal-dock';
import {
  PIWIN_APPEARANCE_DARK,
  isAppearanceFaceId,
  resolveDesktopAppearance,
} from '../appearance-tokens';
import { getDesktopCopy, type DesktopCopy } from '../desktop-locale';
import { useDesktopLocale } from '../desktop-locale-context';
import { createStreamEventBuffer } from '../stream-event-buffer';
import {
  hydrationSessionApplyActions,
  mapListedSessionItem,
  mapListedSessionItems,
  sessionUpdateFromIndexPush,
} from '../remote-session-hydrate';
import { readConfiguredChatModelsData } from '../model-options';
import { resolveBootstrapSelectedModelKey } from '../composer-model-selection-policy.js';
import { publishPetOverlayState } from '../pet-overlay-state-bridge.js';
import { readProjectedHostConfig } from '../remote-settings-hydrate.js';
import { mergeSettingsViewConfig } from '../settings/settings-view-config.js';
import {
  appendBoundedPtyOutput,
  capSeenKeys,
  MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS,
  MAX_SESSION_PLAN_CACHE,
  putRecordLru,
} from '../record-budget';

/** HMR must remount this subscribe effect; `hostClient` identity does not change. */
const HOST_PUSH_LIVE_PATH = 'paced-v2';

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
  activeSessionId: string | null;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  refreshJobs: () => Promise<void>;
  appendJobLog: (jobId: string, text: string) => void;
  setPtyOutput: Dispatch<SetStateAction<PtyOutputLine[]>>;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
  /** Root theme owner callback; this hook never applies document theme state itself. */
  onThemeResolved: (theme: ThemeManifest) => void;
  /** Bump resume selection identity when the active session is deleted remotely. */
  onActiveSessionCleared?: () => void;
};

type PermissionRequestPush = Extract<HostPush, { type: 'permission/request' }>;

export type SessionPlanCache = Readonly<Record<string, SessionPlan | null>>;

export function cacheSessionPlan(
  current: SessionPlanCache,
  sessionId: string,
  plan: SessionPlan | null,
  protectSessionId?: string | null,
): SessionPlanCache {
  return putRecordLru(
    current,
    sessionId,
    plan,
    MAX_SESSION_PLAN_CACHE,
    protectSessionId ? [protectSessionId] : [],
  );
}

export function selectSessionPlan(
  current: SessionPlanCache,
  activeSessionId: string | null,
): SessionPlan | null {
  return activeSessionId ? (current[activeSessionId] ?? null) : null;
}

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
 * Map a durable extension deployment push to a user-visible failure message,
 * or null when nothing needs surfacing. Background activations (quick-ACKed
 * waiting-current-run applies) report their outcome only through this push,
 * so terminal failures must not stay silent. The transient `failed` phase is
 * always followed by a terminal rolled-back/restart-required write; reacting
 * to both would double-report the same failure.
 */
export function describeExtensionDeploymentFailure(
  deployment: ExtensionDeploymentRecord,
  copy?: Pick<
    DesktopCopy,
    | 'extensionDeploymentRolledBack'
    | 'extensionDeploymentRestartRequired'
    | 'extensionDeploymentSuperseded'
  >,
): string | null {
  const rolledBack = copy?.extensionDeploymentRolledBack ?? 'Extension deployment rolled back';
  const restartRequired =
    copy?.extensionDeploymentRestartRequired ??
    'Extension deployment needs a session restart to finish applying';
  const superseded =
    copy?.extensionDeploymentSuperseded ??
    'This extension deployment was superseded by a newer extension configuration';
  if (deployment.phase === 'rolled-back') {
    const detail = deployment.error ? `: ${deployment.error}` : '';
    return `${rolledBack}${detail}`;
  }
  if (deployment.phase === 'restart-required') {
    const detail = deployment.error ? ` (${deployment.error})` : '';
    return `${restartRequired}${detail}`;
  }
  if (deployment.phase === 'superseded') {
    const detail = deployment.error ? `: ${deployment.error}` : '';
    return `${superseded}${detail}`;
  }
  return null;
}

export function extensionDeploymentAnnouncementKey(deployment: ExtensionDeploymentRecord): string {
  return `${deployment.deploymentId}:${deployment.phase}`;
}

/** Dedup reconnect/replay of the same terminal failure for one deployment. */
export function shouldAnnounceExtensionDeploymentFailure(
  seenKeys: Set<string>,
  deployment: ExtensionDeploymentRecord,
  copy?: Pick<
    DesktopCopy,
    | 'extensionDeploymentRolledBack'
    | 'extensionDeploymentRestartRequired'
    | 'extensionDeploymentSuperseded'
  >,
): boolean {
  if (describeExtensionDeploymentFailure(deployment, copy) === null) {
    return false;
  }
  const key = extensionDeploymentAnnouncementKey(deployment);
  if (seenKeys.has(key)) {
    return false;
  }
  seenKeys.add(key);
  capSeenKeys(seenKeys, MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS);
  return true;
}

/**
 * Normalize a `theme/get-active` response into the manifest the root theme
 * owner should apply. Built-in piwin ids resolve to the desktop-owned
 * manifest (a stale host copy must not override desktop tokens); failures
 * fall back to Inkstone's dark face. Pure so the bootstrap theme path is testable
 * without a HostClient stream.
 */
/** Remote shells admit on hello; local sidecar admits on host/status. */
export function resolveShellHostReady(input: {
  transport: ReturnType<HostClient['getTransport']>;
  wireReady: boolean;
  statusSuccess: boolean;
  statusReady?: boolean;
}): boolean {
  if (input.transport === 'remote') {
    return input.wireReady || (input.statusSuccess && input.statusReady === true);
  }
  return input.statusSuccess && input.statusReady === true;
}

/** Read the negotiated context telemetry capability from either local or remote status data. */
export function hasContextTelemetryCapability(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.capabilities)) {
    return false;
  }
  return data.capabilities.contextTelemetryVersion === 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

/** Retained assembly/context summaries (keyed by runId and userMessageId).
 * Entries feed summary cards only; older ones are evicted FIFO. */
const MAX_ASSEMBLY_SUMMARIES = 64;

export function useHostBootstrap(args: UseHostBootstrapArgs) {
  const { locale } = useDesktopLocale();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const announcedExtensionDeploymentsRef = useRef(new Set<string>());
  const [hostStatus, setHostStatus] = useState<HostStatusData | null>(null);
  const [hostReadyEpoch, setHostReadyEpoch] = useState(0);
  /** Bumps on every Host snapshot so App can re-list sessions / reload transcript. */
  const [remoteCatchUpEpoch, setRemoteCatchUpEpoch] = useState(0);
  const lastPushedHostReadyRef = useRef<boolean | null>(null);
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [configuredChatModels, setConfiguredChatModels] = useState<ConfiguredChatModelsData>({
    models: [],
  });
  const [activePet, setActivePetState] = useState<PetRuntimeSnapshot | null>(null);
  const setActivePet = useCallback((update: SetStateAction<PetRuntimeSnapshot | null>) => {
    setActivePetState((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      publishPetOverlayState(next);
      return next;
    });
  }, []);
  const [plansBySessionId, setPlansBySessionId] = useState<Record<string, SessionPlan | null>>({});
  const sessionPlan = selectSessionPlan(plansBySessionId, args.activeSessionId);
  const [extensionUiRequest, setExtensionUiRequest] = useState<ExtensionUiRequestState | null>(
    null,
  );
  const [extensionUiInput, setExtensionUiInput] = useState('');
  const [assemblySummariesByRunId, setAssemblySummariesByRunId] = useState<
    Record<string, import('@piwin/contracts').ContextSummaryPush>
  >({}); /**
   * React state can lag behind a push while an extension-ui resolve is in
   * flight. Keep the latest request synchronously so an old resolve cannot
   * clear the next questionnaire page.
   */
  const extensionUiRequestRef = useRef<ExtensionUiRequestState | null>(null);

  const clearExtensionUiRequest = useCallback((requestId?: string): boolean => {
    const currentRequest = extensionUiRequestRef.current;
    if (requestId !== undefined && currentRequest?.requestId !== requestId) {
      return false;
    }
    extensionUiRequestRef.current = null;
    setExtensionUiRequest(null);
    setExtensionUiInput('');
    return true;
  }, []);

  useEffect(() => {
    const { hostClient, dispatch } = args;
    const streamEventBuffer = createStreamEventBuffer({ dispatch });
    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'hydration') {
        streamEventBuffer.reset();
        const listed = mapListedSessionItems({ sessions: message.snapshot.sessions });
        for (const action of hydrationSessionApplyActions(listed.sessions)) {
          dispatch(action);
        }
        return;
      }
      if (message.type === 'snapshot') {
        // Stale-cursor recovery without full hello hydration. Force catch-up
        // even when the shell was already "ready" (false→true epoch alone
        // would no-op).
        streamEventBuffer.reset();
        const ready = resolveShellHostReady({
          transport: args.hostClient.getTransport(),
          wireReady: args.hostClient.isReady(),
          statusSuccess: true,
          statusReady: message.status.ready,
        });
        dispatch({
          type: 'host/status',
          ready,
          mock: message.status.mock,
        });
        lastPushedHostReadyRef.current = ready;
        setHostReadyEpoch((current) => current + 1);
        setRemoteCatchUpEpoch((current) => current + 1);
        return;
      }
      if (message.type === 'host/status') {
        const ready = resolveShellHostReady({
          transport: args.hostClient.getTransport(),
          wireReady: args.hostClient.isReady(),
          statusSuccess: true,
          statusReady: message.ready,
        });
        dispatch({ type: 'host/status', ready, mock: message.mock });
        if (ready && lastPushedHostReadyRef.current !== true) {
          setHostReadyEpoch((current) => current + 1);
        }
        lastPushedHostReadyRef.current = ready;
        return;
      }
      if (message.type === 'session/context-updated') {
        const snapshot = parseSessionContextSnapshot(message.snapshot);
        if (snapshot) {
          dispatch({
            type: 'context-telemetry/snapshot',
            snapshot,
            source: 'live',
            hostInstanceId: hostClient.getHostInstanceId(),
          });
        }
        return;
      }
      if (message.type === 'event') {
        streamEventBuffer.push(message.sessionId, message.event, message.envelope);
        return;
      }
      if (message.type === 'agent/context-summary') {
        setAssemblySummariesByRunId((current) => {
          const next = { ...current, [message.runId]: message };
          if (message.userMessageId) {
            next[message.userMessageId] = message;
          }
          // Bounded FIFO: summaries accumulate for the app's whole lifetime
          // otherwise; insertion order approximates recency.
          const keys = Object.keys(next);
          if (keys.length > MAX_ASSEMBLY_SUMMARIES) {
            for (const staleKey of keys.slice(0, keys.length - MAX_ASSEMBLY_SUMMARIES)) {
              delete next[staleKey];
            }
          }
          return next;
        });
        return;
      }
      if (message.type === 'run/updated') {
        streamEventBuffer.pushAction(message.run.sessionId, {
          type: 'run/updated',
          run: message.run,
        });
        return;
      }
      if (message.type === 'run/terminal') {
        streamEventBuffer.pushAction(message.run.sessionId, {
          type: 'run/terminal',
          run: message.run,
        });
        const currentExtensionUiRequest = extensionUiRequestRef.current;
        if (currentExtensionUiRequest?.sessionId === message.run.sessionId) {
          clearExtensionUiRequest(currentExtensionUiRequest.requestId);
        }
        return;
      }
      // Job lifecycle pushes are top-level HostPush variants, not AgentEvent
      // envelopes. Refresh the Job list on state changes and stream logs.
      if (
        message.type === 'job/started' ||
        message.type === 'job/updated' ||
        message.type === 'job/ready' ||
        message.type === 'job/exited'
      ) {
        if (hostClient.supportsCommand('job/list')) {
          void args.refreshJobs();
        }
        return;
      }
      if (message.type === 'job/log') {
        const chunk = message.chunk;
        args.appendJobLog(chunk.jobId, chunk.text);
        return;
      }
      if (message.type === 'pty/output') {
        args.setPtyOutput((current) =>
          appendBoundedPtyOutput(current, {
            id: `${message.ptyId}:${message.at}:${current.length}`,
            data: message.data,
            at: message.at,
          }),
        );
        return;
      }
      if (message.type === 'pty/exit') {
        args.setPtyOutput((current) =>
          appendBoundedPtyOutput(current, {
            id: `${message.ptyId}:exit:${current.length}`,
            data: `\n[Shell exited${
              message.exitCode === null || message.exitCode === undefined
                ? ''
                : ` with code ${message.exitCode}`
            }]\n`,
            at: new Date().toISOString(),
          }),
        );
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
      if (message.type === 'reply-writer/updated') {
        dispatch({
          type: 'reply-writer/updated',
          sessionId: message.sessionId,
          messageId: message.messageId,
          status: message.status,
          ...(message.model ? { model: message.model } : {}),
          ...(message.language ? { language: message.language } : {}),
        });
        return;
      }
      if (message.type === 'run/intervention-updated') {
        dispatch({
          type: 'run/intervention-updated',
          intervention: message.intervention,
        });
        return;
      }
      if (message.type === 'session/queued-turn-updated') {
        dispatch({ type: 'session/queued-turn-updated', queuedTurn: message.queuedTurn });
        return;
      }
      if (message.type === 'session/index-updated') {
        if (message.op === 'deleted') {
          dispatch({ type: 'session/remove', sessionId: message.sessionId });
          if (args.activeSessionId === message.sessionId) {
            args.onActiveSessionCleared?.();
            dispatch({ type: 'session/clear-active' });
          }
          return;
        }
        const listed =
          message.session === undefined ? undefined : mapListedSessionItem(message.session);
        if (listed) {
          dispatch(sessionUpdateFromIndexPush(message.op, listed));
        }
        return;
      }
      if (message.type === 'settings/updated') {
        void (async () => {
          const response = await hostClient.request({ type: 'settings/get' });
          if (!response.success) {
            return;
          }
          const snapshot = (response.data as { snapshot?: { config?: PiwinConfig } } | undefined)
            ?.snapshot;
          if (snapshot?.config) {
            setConfig(mergeSettingsViewConfig(snapshot.config));
          }
          await applyConfiguredChatModels(hostClient, setConfiguredChatModels, args.setSelectedModelKey);
        })();
        return;
      }
      if (message.type === 'auth/updated' || message.type === 'auth/login-finished') {
        void applyConfiguredChatModels(hostClient, setConfiguredChatModels, args.setSelectedModelKey);
        return;
      }
      if (message.type === 'session/name-updated') {
        // Host named the session (text on send or LLM after complete). session/update
        // inserts the row when missing so the first text name makes it listable.
        dispatch({
          type: 'session/update',
          session: {
            id: message.sessionId,
            name: message.name,
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
      if (message.type === 'subagent/stream') {
        dispatch({
          type: 'subagent/stream',
          parentSessionId: message.parentSessionId,
          childSessionId: message.childSessionId,
          event: message.event,
          ...(message.envelope ? { envelope: message.envelope } : {}),
        });
        return;
      }
      if (message.type === 'subagent/merged') {
        // Stream state is no longer live once the child is merged.
        dispatch({
          type: 'subagent/clear-stream',
          childSessionId: message.childSessionId,
        });
        return;
      }
      if (message.type === 'subagent/updated') {
        dispatch({
          type: 'subagent/updated',
          parentSessionId: message.parentSessionId,
          child: message.child,
        });
        return;
      }
      if (message.type === 'subagent/invocation-updated') {
        dispatch({
          type: 'subagent/invocation-updated',
          parentSessionId: message.parentSessionId,
          invocation: message.invocation,
        });
        return;
      }
      if (message.type === 'subagent/batch-updated') {
        dispatch({
          type: 'subagent/batch-updated',
          runId: message.runId,
          parentSessionId: message.parentSessionId,
          result: message.result,
        });
        return;
      }
      if (message.type === 'subagent/task-updated') {
        dispatch({
          type: 'subagent/task-updated',
          runId: message.runId,
          parentSessionId: message.parentSessionId,
          result: message.result,
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
      if (message.type === 'permission/resolved') {
        dispatch({
          type: 'permission/clear',
          requestId: message.requestId,
        });
        return;
      }
      if (message.type === 'extension/ui_request') {
        const nextRequest: ExtensionUiRequestState = {
          sessionId: message.sessionId,
          requestId: message.requestId,
          kind: message.kind,
          title: message.title,
          ...(message.message !== undefined ? { message: message.message } : {}),
          ...(message.options !== undefined ? { options: message.options } : {}),
          ...(message.placeholder !== undefined ? { placeholder: message.placeholder } : {}),
        };
        extensionUiRequestRef.current = nextRequest;
        setExtensionUiRequest(nextRequest);
        setExtensionUiInput('');
        return;
      }
      if (message.type === 'extension/deployment-updated') {
        const copy = getDesktopCopy(localeRef.current);
        if (
          !shouldAnnounceExtensionDeploymentFailure(
            announcedExtensionDeploymentsRef.current,
            message.deployment,
            copy,
          )
        ) {
          return;
        }
        const failure = describeExtensionDeploymentFailure(message.deployment, copy);
        if (failure) {
          dispatch({ type: 'error', message: failure });
        }
        return;
      }
      if (message.type === 'plan/updated') {
        setPlansBySessionId((current) =>
          cacheSessionPlan(current, message.sessionId, message.plan, args.activeSessionId),
        );
        return;
      }
      if (message.type === 'plan/execution-updated') {
        // Execution state is already embedded in the latest plan/updated push;
        // no separate state update needed here. This handler exists so the
        // push is not logged as unhandled.
        return;
      }
      if (message.type === 'walkthrough/updated') {
        dispatch({ type: 'walkthrough/updated', artifact: message.artifact });
        return;
      }
      if (message.type === 'pet/state') {
        // Overlay has no Host connection; the setter publishes to it.
        setActivePet(message.pet);
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
          message.command === 'settings/get' ||
          message.command === 'settings/apply' ||
          isRemoteCommandGapError(message.error)
        ) {
          return;
        }
        dispatch({ type: 'error', message: message.error });
      }
    });

    let cancelled = false;
    void (async () => {
      try {
        await hostClient.connect();
        if (cancelled) {
          return;
        }
        const statusResponse = await hostClient.request({ type: 'host/status' });
        if (cancelled) {
          return;
        }
        const ready = resolveShellHostReady({
          transport: hostClient.getTransport(),
          wireReady: hostClient.isReady(),
          statusSuccess: statusResponse.success,
          ...(statusResponse.success === true
            ? { statusReady: (statusResponse.data as HostStatusData).ready === true }
            : {}),
        });
        if (statusResponse.success) {
          const statusData = statusResponse.data as HostStatusData;
          setHostStatus(statusData);
          dispatch({
            type: 'context-telemetry/capability',
            supported: hasContextTelemetryCapability(statusResponse.data),
          });
        }
        // Request path must update the shell pill; push-only left UI stuck offline after HMR.
        dispatch({
          type: 'host/status',
          ready,
          mock:
            statusResponse.success === true
              ? (statusResponse.data as HostStatusData).mock === true
              : false,
        });
      } catch (error) {
        if (cancelled || isWorkbenchHostTeardownError(formatError(error))) {
          return;
        }
        dispatch({
          type: 'host/status',
          ready: resolveShellHostReady({
            transport: hostClient.getTransport(),
            wireReady: hostClient.isReady(),
            statusSuccess: false,
          }),
          mock: false,
        });
        dispatch({
          type: 'error',
          message: formatError(error),
        });
      }
      if (cancelled) {
        return;
      }
      try {
        // Remote Hosts do not allow config/get (secrets). Skip it so General
        // session hydrate is not gated on a null config.
        if (hostClient.getTransport() !== 'remote') {
          const configResponse = await hostClient.request({ type: 'config/get' });
          if (configResponse.success) {
            const data = configResponse.data as { config?: PiwinConfig } | undefined;
            const nextConfig = data?.config;
            if (nextConfig !== undefined) {
              setConfig(nextConfig);
            }
          }
          await applyConfiguredChatModels(
            hostClient,
            setConfiguredChatModels,
            args.setSelectedModelKey,
          );
        } else {
          await applyConfiguredChatModels(
            hostClient,
            setConfiguredChatModels,
            args.setSelectedModelKey,
          );
          const projected = await readProjectedHostConfig(hostClient);
          if (projected !== undefined) {
            setConfig(projected);
            applyBootstrapSelectedModelKey(
              args.setSelectedModelKey,
              projected.defaultProviderId,
              projected.defaultModelId,
            );
          }
        }
      } catch {
        // Retry on hostReadyEpoch below; do not take down the shell.
      }
      if (hostClient.supportsCommand('theme/get-active')) {
        const themeResponse = await hostClient.request({ type: 'theme/get-active' });
        // DesktopThemeRoot already applied Appearance prefs at mount. Only push
        // library / installed packages from the host; Inkstone faces and the
        // three-color Appearance overrides must not stomp the user's mode
        // (that was a second theme flash). Retired ids are migrated first —
        // resolveDesktopAppearance rewrites retired defaults to Inkstone, so a
        // literal id check against the old names would miss and re-apply.
        const bootstrappedTheme = resolveThemeBootstrapResponse(themeResponse);
        if (!isAppearanceFaceId(bootstrappedTheme.id)) {
          args.onThemeResolved(bootstrappedTheme);
        }
      }
      if (hostClient.supportsCommand('pet/get-active')) {
        const petResponse = await hostClient.request({ type: 'pet/get-active' });
        if (petResponse.success) {
          const petData = petResponse.data as { pet: PetRuntimeSnapshot };
          setActivePet(petData.pet);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      streamEventBuffer.dispose();
      // Do not dispose the host on React effect re-runs / HMR remounts.
      // Killing the sidecar here races the next connect() and leaves the UI offline
      // while the process map still says "alreadyRunning" or is mid-shutdown.
      // App lifetime owns the HostClient; OS/window close tears down Tauri.
    };
    // Bootstrap once per hostClient instance; setters are stable.
    // HOST_PUSH_LIVE_PATH is in the deps so HMR actually resubscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.hostClient, HOST_PUSH_LIVE_PATH]);

  // Same class of bug as project/list: a cold sidecar makes the first
  // config/get fail. Retry when Host actually becomes ready.
  useEffect(() => {
    if (hostReadyEpoch === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (args.hostClient.getTransport() === 'remote') {
          await applyConfiguredChatModels(
            args.hostClient,
            setConfiguredChatModels,
            args.setSelectedModelKey,
          );
          const projected = await readProjectedHostConfig(args.hostClient);
          if (!cancelled && projected !== undefined) {
            setConfig(projected);
            applyBootstrapSelectedModelKey(
              args.setSelectedModelKey,
              projected.defaultProviderId,
              projected.defaultModelId,
            );
          }
          return;
        }
        const configResponse = await args.hostClient.request({ type: 'config/get' });
        if (cancelled || !configResponse.success) {
          return;
        }
        const data = configResponse.data as { config?: PiwinConfig } | undefined;
        const nextConfig = data?.config;
        if (nextConfig !== undefined) {
          setConfig(nextConfig);
        }
        await applyConfiguredChatModels(
          args.hostClient,
          setConfiguredChatModels,
          args.setSelectedModelKey,
        );
      } catch {
        // Keep the shell up; the next ready epoch retries.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.hostClient, hostReadyEpoch]);

  useEffect(() => {
    const sessionId = args.activeSessionId;
    if (!sessionId || hostStatus?.ready !== true) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await args.hostClient.request({
          type: 'session/model-context-summary',
          sessionId,
        });
        if (cancelled || !response.success) return;
        const data = response.data as import('@piwin/contracts').ModelContextSummaryData;
        setAssemblySummariesByRunId((current) => {
          const next = { ...current };
          for (const summary of data.summaries) {
            next[summary.runId] = summary;
            if (summary.userMessageId) {
              next[summary.userMessageId] = summary;
            }
          }
          return next;
        });
      } catch {
        // Historical assembly is best-effort; live pushes still populate the map.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [args.activeSessionId, args.hostClient, hostReadyEpoch, hostStatus?.ready]);

  useEffect(() => {
    const sessionId = args.activeSessionId;
    if (!sessionId || hostStatus?.ready !== true) return;
    let cancelled = false;
    void (async () => {
      if (args.hostClient.supportsCommand?.('plan/get') === false) {
        return;
      }
      try {
        const response = await args.hostClient.request({ type: 'plan/get', sessionId });
        if (cancelled || !response.success) return;
        const data = response.data as { sessionId: string; plan: SessionPlan | null };
        setPlansBySessionId((current) =>
          cacheSessionPlan(current, data.sessionId, data.plan, args.activeSessionId),
        );
      } catch (error) {
        if (!cancelled && !isRemoteCommandGapError(formatError(error))) {
          args.dispatch({
            type: 'error',
            message: `Failed to restore session plan: ${formatError(error)}`,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [args.activeSessionId, args.hostClient, hostReadyEpoch, hostStatus?.ready]);

  return {
    hostStatus,
    setHostStatus,
    config,
    setConfig,
    activePet,
    setActivePet,
    sessionPlan,
    extensionUiRequest,
    setExtensionUiRequest,
    extensionUiInput,
    setExtensionUiInput,
    clearExtensionUiRequest,
    assemblySummariesByRunId,
    configuredChatModels,
    remoteCatchUpEpoch,
  };
}

async function applyConfiguredChatModels(
  hostClient: HostClient,
  setConfiguredChatModels: Dispatch<SetStateAction<ConfiguredChatModelsData>>,
  setSelectedModelKey: Dispatch<SetStateAction<string>>,
): Promise<void> {
  const response = await hostClient.request({ type: 'models/configured' });
  if (!response.success) {
    return;
  }
  const next = readConfiguredChatModelsData(response.data);
  setConfiguredChatModels(next);
  applyBootstrapSelectedModelKey(setSelectedModelKey, next.defaultProviderId, next.defaultModelId);
}

function applyBootstrapSelectedModelKey(
  setSelectedModelKey: Dispatch<SetStateAction<string>>,
  defaultProviderId: string | undefined,
  defaultModelId: string | undefined,
): void {
  if (!defaultProviderId || !defaultModelId) {
    return;
  }
  setSelectedModelKey((current) =>
    resolveBootstrapSelectedModelKey(current, defaultProviderId, defaultModelId),
  );
}
