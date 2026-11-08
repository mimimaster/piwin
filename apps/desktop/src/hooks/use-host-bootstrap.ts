/**
 * Connect host, subscribe to HostServerMessage stream, bootstrap config/theme/pet/status.
 * Pure helpers live in `use-host-bootstrap-helpers.ts` (re-exported below);
 * push dispatch + bootstrap routines live in `use-host-bootstrap-handlers.ts`.
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
  ContextSummaryPush,
  HostStatusData,
  PetRuntimeSnapshot,
  PiwinConfig,
  SessionPlan,
  ThemeManifest,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import type { ChatUiAction } from '../conversation/chat-reducer';
import type { NotificationAction } from '../notifications/notification-queue';
import type { HostLogEntry } from '../host/HostLogPanel';
import type { PtyOutputLine } from '../terminal/terminal-dock';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { createStreamEventBuffer } from '../conversation/stream-event-buffer';
import { publishPetOverlayState } from '../pet/pet-overlay-state-bridge.js';
import { useBackendUserInput } from './use-backend-user-input.js';
import { useExtensionUiRequests } from './use-extension-ui-requests';
import {
  fetchModelContextSummaries,
  fetchSessionPlan,
  handleHostServerMessage,
  reloadConfigAfterHostReady,
  runHostBootstrap,
} from './use-host-bootstrap-handlers.js';
import { selectSessionPlan } from './use-host-bootstrap-helpers.js';

/** HMR must remount this subscribe effect; `hostClient` identity does not change. */
const HOST_PUSH_LIVE_PATH = 'paced-v2';

export type { ExtensionUiRequestState } from '../extensions/extension-ui-request-registry';

export {
  cacheSessionPlan,
  describeExtensionDeploymentFailure,
  extensionDeploymentAnnouncementKey,
  hasContextTelemetryCapability,
  resolveShellHostReady,
  resolveThemeBootstrapResponse,
  selectSessionPlan,
  shouldAnnounceExtensionDeploymentFailure,
} from './use-host-bootstrap-helpers.js';
export type { SessionPlanCache } from './use-host-bootstrap-helpers.js';

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
  const [assemblySummariesByRunId, setAssemblySummariesByRunId] = useState<
    Record<string, ContextSummaryPush>
  >({});
  const extensionUi = useExtensionUiRequests(args.activeSessionId);
  const backendInput = useBackendUserInput(args.activeSessionId);

  useEffect(() => {
    const streamEventBuffer = createStreamEventBuffer({ dispatch: args.dispatch });
    let cancelled = false;
    const runtime = {
      args,
      isCancelled: () => cancelled,
      localeRef,
      streamEventBuffer,
      syncedReadyAgents: new Set<string>(),
      announcedExtensionDeployments: announcedExtensionDeploymentsRef.current,
      lastPushedHostReadyRef,
      setHostStatus,
      setHostReadyEpoch,
      setRemoteCatchUpEpoch,
      setConfig,
      setConfiguredChatModels,
      setActivePet,
      setPlansBySessionId,
      setAssemblySummariesByRunId,
      extensionUi,
      backendInput,
    };
    const unsubscribe = args.hostClient.subscribe((message) =>
      handleHostServerMessage(runtime, message),
    );
    void runHostBootstrap(runtime);

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
    void reloadConfigAfterHostReady({
      hostClient: args.hostClient,
      isCancelled: () => cancelled,
      setConfig,
      setConfiguredChatModels,
      setSelectedModelKey: args.setSelectedModelKey,
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.hostClient, hostReadyEpoch]);

  useEffect(() => {
    const sessionId = args.activeSessionId;
    if (!sessionId || hostStatus?.ready !== true) return;
    let cancelled = false;
    void fetchModelContextSummaries({
      hostClient: args.hostClient,
      sessionId,
      isCancelled: () => cancelled,
      setAssemblySummariesByRunId,
    });
    return () => {
      cancelled = true;
    };
  }, [args.activeSessionId, args.hostClient, hostReadyEpoch, hostStatus?.ready]);

  useEffect(() => {
    const sessionId = args.activeSessionId;
    if (!sessionId || hostStatus?.ready !== true) return;
    let cancelled = false;
    void fetchSessionPlan({
      hostClient: args.hostClient,
      sessionId,
      activeSessionId: args.activeSessionId,
      isCancelled: () => cancelled,
      setPlansBySessionId,
      dispatch: args.dispatch,
    });
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
    extensionUiRequest: extensionUi.extensionUiRequest,
    extensionUiQuestionSessionIds: extensionUi.extensionUiQuestionSessionIds,
    extensionUiInput: extensionUi.extensionUiInput,
    setExtensionUiInput: extensionUi.setExtensionUiInput,
    clearExtensionUiRequest: extensionUi.clearExtensionUiRequest,
    backendUserInput: backendInput.backendUserInput,
    clearBackendUserInput: backendInput.clearBackendUserInput,
    assemblySummariesByRunId,
    configuredChatModels,
    remoteCatchUpEpoch,
  };
}
