import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  ActivitySummaryItem,
  ConfiguredChatModel,
  ModelRef,
  RemoteHostStatusData,
  RemoteProjectSummary,
  RemoteSessionSummary,
  ThinkingLevel,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import {
  applyForegroundRunResponse,
  applyHostPushToForeground,
  foregroundMutationsEnabled,
  HostClient,
  initialForegroundRunState,
  knownForegroundRunId,
  reduceForegroundRun,
  type ForegroundRunState,
  type HostClientState,
} from '@piwin/host-client';
import {
  healthConsentScopeKey,
  type ClientToolPreferenceStore,
} from '../client-tools/client-tool-preferences.js';
import type { MobileClientToolConsentDecision } from '../client-tools/mobile-client-tool-runtime.js';
import { useHostWake } from './use-host-wake.js';
import {
  clearLastMobileHostEndpoint,
  writeLastMobileHostEndpoint,
} from '../mobile-last-host-endpoint.js';
import { MobileClientToolRuntime } from '../client-tools/mobile-client-tool-runtime.js';
import {
  advertiseMobileHealthRuntime,
  attachMobileClientToolRuntime,
  buildMobileHelloCapabilities,
  createLocalClientToolPreferenceStore,
  healthExecutorUsable,
  readHealthConnectedSetting,
  resolveMobileHealthDeviceId,
  shouldAdvertiseHealthOnHello,
  shouldIncludeAppleHealthOnSend,
} from '../client-tools/mobile-health-session.js';
import {
  healthkitIsAvailable,
} from '../health/native-healthkit.js';
import { useMobileAppleHealth } from './use-mobile-apple-health.js';
import {
  createMobileHostClient,
  formatMobileHostConnectionError,
  getDefaultHostEndpoint,
  normalizeMobileHostEndpoint,
  type MobileHostConnectionInput,
} from '../mobile-host-connection.js';
import {
  readMobileDeviceCredential,
  isNativeTauriRuntime,
  type MobileDeviceCredentialVault,
} from '../mobile-device-credential-vault.js';
import {
  createMobileVault,
  disposeClient,
  toError,
} from '../mobile-host-helpers.js';
import {
  readPauseCheckpointId,
  readRunId,
} from '../mobile-host-readers.js';
import {
  createMobileIdempotencyKey,
  executeMobileMutation,
  nextMobileSendIntent,
  readMobilePromptFailure,
} from '../mobile-prompt-send.js';
import {
  ACTIVITY_SUMMARY_REFRESH_DEBOUNCE_MS,
  requestActivitySummary,
  shouldRefreshActivitySummary,
} from '../mobile-activity-summary.js';
import { createMobileRemoteReadModelRefresher } from './mobile-host-read-model.js';
import { uploadMobileImage } from './mobile-media-upload.js';
import { abortMobileRun, resolveMobilePermission } from './mobile-run-controls.js';
import {
  createMobileSession,
  createSessionListSync,
  mobileSessionListCommand,
  readSessionListPage,
  runSessionListMutation,
} from './mobile-session-list.js';
import { useMobileKnowledge } from './use-mobile-knowledge.js';
import {
  handleRemotePush,
  readSessionMessages,
  type MobileMediaAttachment,
  type MobileTranscriptMessage,
  type MobileToolCall,
  type RemotePermissionRequest,
} from '../mobile-transcript.js';

export type { MobileMediaAttachment, MobileToolCall, MobileTranscriptMessage, RemotePermissionRequest };

const MOBILE_DEVICE_NAME = 'Piwin mobile';

export function useMobileHost() {
  const [endpoint, setEndpoint] = useState(getDefaultHostEndpoint);
  const [authToken, setAuthToken] = useState('');
  const [pairingToken, setPairingToken] = useState('');
  const [expectedHostInstanceId, setExpectedHostInstanceId] = useState<string | undefined>();
  const [connectionState, setConnectionState] = useState<HostClientState>({ kind: 'idle' });
  const [hostStatus, setHostStatus] = useState<RemoteHostStatusData | undefined>();
  const [projects, setProjects] = useState<RemoteProjectSummary[]>([]);
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  // Stable across renders: debounces Host-driven list refreshes.
  const [sessionListSync] = useState(() => createSessionListSync(setSessions));
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<MobileTranscriptMessage[]>([]);
  const [composerText, setComposerText] = useState('');
  const [foreground, setForeground] = useState<ForegroundRunState>(initialForegroundRunState);
  const activeRunId = knownForegroundRunId(foreground);
  const mutationsEnabled = foregroundMutationsEnabled(foreground);
  const [pausedCheckpointId, setPausedCheckpointId] = useState<string | undefined>();
  const [permissionRequest, setPermissionRequest] = useState<RemotePermissionRequest | undefined>();
  const [attachments, setAttachments] = useState<MobileMediaAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isResolvingPermission, setIsResolvingPermission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [pendingReplaceRunId, setPendingReplaceRunId] = useState<string | undefined>();
  const [credentialPersistError, setCredentialPersistError] = useState(false);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredChatModel[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | undefined>();
  const [defaultModelId, setDefaultModelId] = useState<string | undefined>();
  const [activityItems, setActivityItems] = useState<ActivitySummaryItem[]>([]);
  const [artifactEnabled, setArtifactEnabled] = useState(true);

  const clientRef = useRef<HostClient | undefined>(undefined);
  const activeSessionRef = useRef<string | undefined>(undefined);
  const selectionGenerationRef = useRef(0);
  const initialConnectInFlightRef = useRef(false);
  const connectAttemptRef = useRef(0);
  const unsubscribeRef = useRef<Array<() => void>>([]);
  const vaultRef = useRef<MobileDeviceCredentialVault>(createMobileVault());
  const deviceCredentialRef = useRef<TrustedDeviceCredential | undefined>(undefined);
  const deviceCredentialEndpointRef = useRef<string | undefined>(undefined);
  const activityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const healthRuntimeRef = useRef<MobileClientToolRuntime | undefined>(undefined);
  const healthPreferencesRef = useRef<ClientToolPreferenceStore>(createLocalClientToolPreferenceStore());
  const healthScopeKeyRef = useRef<string | undefined>(undefined);
  const healthConsentResolverRef = useRef<
    ((decision: MobileClientToolConsentDecision) => void) | undefined
  >(undefined);

  const {
    healthNativeAvailable,
    setHealthNativeAvailable,
    healthConnected,
    setHealthConnected,
    healthUseMode,
    setHealthUseMode,
    includeAppleHealth,
    setIncludeAppleHealth,
    hostSupportsClientTools,
    setHostSupportsClientTools,
    healthConsentRequest,
    setHealthConsentRequest,
    healthAlwaysAllowUnlocked,
    setHealthAlwaysAllowUnlocked,
    healthEnabled,
    handleConnectAppleHealth,
    handleDisconnectAppleHealth,
    handleChangeHealthUseMode,
    resolveHealthConsent,
  } = useMobileAppleHealth({
    clientRef,
    healthRuntimeRef,
    healthPreferencesRef,
    healthScopeKeyRef,
    healthConsentResolverRef,
    setErrorMessage,
  });

  const {
    knowledgeBases,
    setKnowledgeBases,
    wikiOverview,
    setWikiOverview,
    knowledgeError,
    setKnowledgeError,
    refreshKnowledge,
    handleKnowledgeSearch,
    handleOpenKnowledgeSource,
    handleSetSessionKnowledgeBases,
    handleAddKnowledgeBase,
    handleDistillWiki,
  } = useMobileKnowledge({
    clientRef,
    setSessions,
    sessionListCommand: mobileSessionListCommand,
  });

  useHostWake(clientRef, () => void handleConnect());

  useEffect(() => {
    let active = true;
    void (async (): Promise<void> => {
      const savedEndpoint = getDefaultHostEndpoint();
      const savedCredential = await readMobileDeviceCredential(vaultRef.current, savedEndpoint);
      if (!active) return;
      if (savedCredential !== undefined) {
        deviceCredentialRef.current = savedCredential;
        deviceCredentialEndpointRef.current = savedEndpoint;
      }
      await handleConnect();
    })();
    return () => {
      active = false;
      connectAttemptRef.current += 1;
      disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef, healthRuntimeRef);
    };
  }, []);

  const refreshActivitySummary = async (client: HostClient): Promise<void> => {
    const summary = await requestActivitySummary(client);
    if (clientRef.current !== client) {
      return;
    }
    setActivityItems(summary.items);
  };

  const beginSessionForeground = async (
    client: HostClient,
    sessionId: string,
    expectedGeneration?: number,
  ): Promise<void> => {
    const generation = expectedGeneration ?? selectionGenerationRef.current + 1;
    if (expectedGeneration === undefined) {
      selectionGenerationRef.current = generation;
    }
    setForeground(reduceForegroundRun(initialForegroundRunState(), { type: 'begin-reconcile', generation }, sessionId));
    if (typeof client.updateSubscriptions === 'function') {
      try {
        await client.updateSubscriptions([sessionId]);
      } catch {
        // Subscriptions are best-effort; foreground-run still gates Send.
      }
    }
    const response = await client.request({ type: 'session/foreground-run', sessionId });
    if (
      clientRef.current !== client ||
      activeSessionRef.current !== sessionId ||
      selectionGenerationRef.current !== generation
    ) {
      return;
    }
    setForeground((current) => applyForegroundRunResponse(current, response, generation, sessionId));
  };

  const scheduleActivityRefresh = (client: HostClient): void => {
    if (activityRefreshTimerRef.current !== undefined) {
      clearTimeout(activityRefreshTimerRef.current);
    }
    activityRefreshTimerRef.current = setTimeout(() => {
      activityRefreshTimerRef.current = undefined;
      void refreshActivitySummary(client);
    }, ACTIVITY_SUMMARY_REFRESH_DEBOUNCE_MS);
  };

  const refreshRemoteReadModel = createMobileRemoteReadModelRefresher({
    clientRef,
    activeSessionRef,
    selectionGenerationRef,
    setHostStatus,
    setErrorMessage,
    setProjects,
    setSessions,
    setConfiguredModels,
    setDefaultProviderId,
    setDefaultModelId,
    setActivityItems,
    setArtifactEnabled,
    setActiveSessionId,
    setMessages,
    setPausedCheckpointId,
    beginSessionForeground,
  });

  const handleConnect = async (input?: MobileHostConnectionInput): Promise<boolean> => {
    const connectionInput =
      input ??
      ({
        endpoint,
        authToken,
        pairingToken,
        ...(expectedHostInstanceId === undefined ? {} : { expectedHostInstanceId }),
      } satisfies MobileHostConnectionInput);
    const attemptId = connectAttemptRef.current + 1;
    connectAttemptRef.current = attemptId;

    let normalizedEndpoint: string;
    try {
      normalizedEndpoint = normalizeMobileHostEndpoint(connectionInput.endpoint);
    } catch (error) {
      setErrorMessage(formatMobileHostConnectionError(error));
      return false;
    }

    const pairing = connectionInput.pairingToken.trim();
    const door = connectionInput.authToken.trim();
    if (pairing.length > 0 && door.length > 0) {
      setErrorMessage('请只填写配对令牌或 Host 口令其中一项。');
      return false;
    }

    if (input !== undefined) {
      setEndpoint(normalizedEndpoint);
      setAuthToken(connectionInput.authToken);
      setPairingToken(connectionInput.pairingToken);
      setExpectedHostInstanceId(connectionInput.expectedHostInstanceId);
    }

    disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef, healthRuntimeRef);
    setErrorMessage(undefined);
    setCredentialPersistError(false);
    setPendingReplaceRunId(undefined);
    setHostStatus(undefined);
    setArtifactEnabled(true);
    setProjects([]);
    setSessions([]);
    setActivityItems([]);
    setKnowledgeBases([]);
    setWikiOverview(undefined);
    setKnowledgeError(undefined);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setForeground(initialForegroundRunState());
    setPausedCheckpointId(undefined);
    setPermissionRequest(undefined);
    setAttachments([]);

    if (deviceCredentialEndpointRef.current !== normalizedEndpoint) {
      deviceCredentialRef.current = undefined;
      deviceCredentialEndpointRef.current = normalizedEndpoint;
    }
    if (deviceCredentialRef.current === undefined) {
      deviceCredentialRef.current = await readMobileDeviceCredential(
        vaultRef.current,
        normalizedEndpoint,
      );
    }

    if (attemptId !== connectAttemptRef.current) {
      return false;
    }

    const nativeAvailable = await healthkitIsAvailable();
    if (attemptId !== connectAttemptRef.current) {
      return false;
    }
    setHealthNativeAvailable(nativeAvailable);
    const production = import.meta.env.PROD === true;
    const allowFakeHealth = import.meta.env.DEV === true;
    const connectedSetting = readHealthConnectedSetting();
    setHealthConnected(connectedSetting);
    const advertiseHealth = shouldAdvertiseHealthOnHello({
      healthConnected: connectedSetting,
      nativeAvailable,
      production,
      allowFake: allowFakeHealth,
    });

    const client = createMobileHostClient(
      normalizedEndpoint,
      {
        ...(pairing.length > 0
          ? { pairingToken: pairing, deviceName: MOBILE_DEVICE_NAME }
          : door.length > 0
            ? { authToken: door }
            : deviceCredentialRef.current !== undefined
              ? { deviceCredential: deviceCredentialRef.current }
              : {}),
        onIssuedDeviceCredential: async (issued) => {
          if (attemptId !== connectAttemptRef.current) {
            return;
          }
          deviceCredentialRef.current = issued;
          deviceCredentialEndpointRef.current = normalizedEndpoint;
          try {
            await vaultRef.current.write(normalizedEndpoint, issued);
            setCredentialPersistError(false);
          } catch {
            setCredentialPersistError(true);
          }
        },
      },
      buildMobileHelloCapabilities({ advertiseHealth }),
    );
    clientRef.current = client;
    initialConnectInFlightRef.current = true;
    unsubscribeRef.current.push(
      client.subscribeState((state) => {
        setConnectionState(state);
        if (state.kind === 'ready' && !initialConnectInFlightRef.current) {
          void refreshRemoteReadModel(client);
          void refreshKnowledge(client);
        }
      }),
    );
    unsubscribeRef.current.push(
      client.subscribePush((push) => {
        handleRemotePush(
          push,
          activeSessionRef,
          setMessages,
          setPausedCheckpointId,
          setPermissionRequest,
        );
        setForeground((current) =>
          applyHostPushToForeground(current, push, activeSessionRef.current),
        );
        if (shouldRefreshActivitySummary(push)) {
          scheduleActivityRefresh(client);
        }
        if (push.type === 'knowledge/bases-changed') {
          setKnowledgeBases(push.bases);
          setKnowledgeError(undefined);
        }
        sessionListSync.handlePush(client, push);
      }),
    );
    unsubscribeRef.current.push(() => sessionListSync.dispose());

    try {
      await client.connect();
      if (attemptId !== connectAttemptRef.current || clientRef.current !== client) {
        return false;
      }
      writeLastMobileHostEndpoint(normalizedEndpoint);
      if (pairing.length > 0) {
        setPairingToken('');
      }
      const connectedInstanceId = client.getCursor().hostInstanceId;
      if (
        connectionInput.expectedHostInstanceId !== undefined &&
        connectedInstanceId !== undefined &&
        connectionInput.expectedHostInstanceId !== connectedInstanceId
      ) {
        setErrorMessage('Host 实例标识与配对码不一致。设备凭证仍然有效；若连错机器请重新扫码。');
      }
      await refreshRemoteReadModel(client);
      await refreshKnowledge(client);
      const hello = client.getHostHello();
      const pairedDeviceId = deviceCredentialRef.current?.deviceId ?? hello?.deviceId;
      const resolvedDeviceId = resolveMobileHealthDeviceId({
        ...(pairedDeviceId === undefined ? {} : { deviceId: pairedDeviceId }),
        clientId: client.getClientId(),
      });
      healthScopeKeyRef.current = await healthConsentScopeKey(normalizedEndpoint, resolvedDeviceId);
      const grant = healthPreferencesRef.current.read(healthScopeKeyRef.current);
      if (grant !== undefined) {
        setHealthUseMode(grant.mode);
        setHealthAlwaysAllowUnlocked(grant.alwaysAllowUnlocked);
      }
      setHostSupportsClientTools(client.supportsClientToolRequests());
      healthRuntimeRef.current = attachMobileClientToolRuntime({
        client,
        endpoint: normalizedEndpoint,
        deviceId: resolvedDeviceId,
        preferences: healthPreferencesRef.current,
        healthEnabled: advertiseHealth && grant?.mode !== 'off',
        nativeHealthAvailable: nativeAvailable,
        production,
        allowFakeHealth,
        requestConsent: (request) => {
          const scopeKey = healthScopeKeyRef.current;
          const stored =
            scopeKey === undefined ? undefined : healthPreferencesRef.current.read(scopeKey);
          setHealthAlwaysAllowUnlocked(stored?.alwaysAllowUnlocked === true);
          return new Promise<MobileClientToolConsentDecision>((resolve) => {
            healthConsentResolverRef.current = resolve;
            setHealthConsentRequest(request);
          });
        },
      });
      await advertiseMobileHealthRuntime(healthRuntimeRef.current);
      return true;
    } catch (error) {
      if (attemptId !== connectAttemptRef.current) {
        return false;
      }
      setErrorMessage(formatMobileHostConnectionError(error));
      return false;
    } finally {
      if (attemptId === connectAttemptRef.current) {
        initialConnectInFlightRef.current = false;
      }
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    initialConnectInFlightRef.current = false;
    try {
      await vaultRef.current.clear(endpoint.trim());
    } catch {
      // Clearing the local vault must not block disconnect.
    }
    clearLastMobileHostEndpoint();
    deviceCredentialRef.current = undefined;
    deviceCredentialEndpointRef.current = undefined;
    connectAttemptRef.current += 1;
    setCredentialPersistError(false);
    setPendingReplaceRunId(undefined);
    disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef, healthRuntimeRef);
    setHostSupportsClientTools(false);
    setHealthConsentRequest(undefined);
    healthConsentResolverRef.current = undefined;
    healthScopeKeyRef.current = undefined;
    setConnectionState({ kind: 'disconnected' });
    setHostStatus(undefined);
    setArtifactEnabled(true);
    setProjects([]);
    setSessions([]);
    setActivityItems([]);
    setKnowledgeBases([]);
    setWikiOverview(undefined);
    setKnowledgeError(undefined);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setForeground(initialForegroundRunState());
    setPausedCheckpointId(undefined);
    setPermissionRequest(undefined);
    setAttachments([]);
  };

  const retryCredentialPersist = async (): Promise<void> => {
    const issued = deviceCredentialRef.current;
    const normalizedEndpoint = endpoint.trim();
    if (issued === undefined || normalizedEndpoint.length === 0) {
      return;
    }
    try {
      await vaultRef.current.write(normalizedEndpoint, issued);
      setCredentialPersistError(false);
    } catch {
      setCredentialPersistError(true);
    }
  };

  const handleSelectSession = async (sessionId: string): Promise<void> => {
    const client = clientRef.current;
    if (client === undefined) {
      return;
    }
    const generation = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = generation;
    activeSessionRef.current = sessionId;
    setActiveSessionId(sessionId);
    setPausedCheckpointId(undefined);
    setPermissionRequest(undefined);
    setAttachments([]);
    setErrorMessage(undefined);
    setPendingReplaceRunId(undefined);
    // A selection change invalidates the previous foreground run immediately;
    // the new Host snapshot will install its own run after hydration.
    setForeground(initialForegroundRunState());
    try {
      const resumeResponse = await client.request({ type: 'session/resume', sessionId });
      if (
        clientRef.current !== client ||
        activeSessionRef.current !== sessionId ||
        selectionGenerationRef.current !== generation
      ) {
        return;
      }
      if (resumeResponse.success) {
        setMessages(readSessionMessages(resumeResponse));
        setPausedCheckpointId(readPauseCheckpointId(resumeResponse.data));
        await beginSessionForeground(client, sessionId, generation);
        return;
      }
      const messagesResponse = await client.request({ type: 'session/messages', sessionId });
      if (
        clientRef.current !== client ||
        activeSessionRef.current !== sessionId ||
        selectionGenerationRef.current !== generation
      ) {
        return;
      }
      setMessages(readSessionMessages(messagesResponse));
      await beginSessionForeground(client, sessionId, generation);
    } catch (error) {
      if (
        clientRef.current === client &&
        activeSessionRef.current === sessionId &&
        selectionGenerationRef.current === generation
      ) {
        setErrorMessage(toError(error, '读取会话消息失败。').message);
      }
    }
  };

  const handleCreateSession = async (projectId?: string): Promise<string | undefined> => {
    const client = clientRef.current;
    if (client === undefined) {
      return undefined;
    }
    const created = await createMobileSession(client, projectId);
    if (!created.ok) {
      setErrorMessage(created.message);
      return undefined;
    }
    setSessions(created.sessions);
    await handleSelectSession(created.sessionId);
    return created.sessionId;
  };

  const handlePinSession = (sessionId: string, isPinned: boolean): Promise<boolean> =>
    runSessionListMutation({
      client: clientRef.current,
      command: { type: isPinned ? 'session/unpin' : 'session/pin', sessionId },
      setSessions,
      setErrorMessage,
      failureMessage: '置顶操作失败。',
    });

  const handleRenameSession = async (sessionId: string, newName: string): Promise<boolean> =>
    newName.trim().length === 0
      ? false
      : runSessionListMutation({
          client: clientRef.current,
          command: { type: 'session/rename', sessionId, name: newName.trim() },
          setSessions,
          setErrorMessage,
          failureMessage: '重命名失败。',
        });

  const handleDeleteSession = async (sessionId: string): Promise<boolean> => {
    const client = clientRef.current;
    if (client === undefined) return false;
    try {
      const response = await client.request({
        type: 'session/archive',
        sessionId,
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return false;
      }
      const nextSessionsResponse = await client.request(mobileSessionListCommand());
      const nextSessions = readSessionListPage(nextSessionsResponse);
      setSessions(nextSessions);
      if (activeSessionId === sessionId) {
        if (nextSessions.length > 0 && nextSessions[0] !== undefined) {
          await handleSelectSession(nextSessions[0].sessionId);
        } else {
          setActiveSessionId(undefined);
          activeSessionRef.current = undefined;
          selectionGenerationRef.current += 1;
          setMessages([]);
          setForeground(initialForegroundRunState());
        }
      }
      return true;
    } catch (error) {
      setErrorMessage(toError(error, '删除会话失败。').message);
      return false;
    }
  };

  const handleSend = async (
    turn?: {
      model?: ModelRef;
      thinkingLevel?: ThinkingLevel;
      text?: string;
    },
    replaceRunId?: string,
    queueAgainstRunId?: string,
  ): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    const selectionGeneration = selectionGenerationRef.current;
    const text = (turn?.text ?? composerText).trim();
    if (
      client === undefined ||
      sessionId === undefined ||
      (text.length === 0 && attachments.length === 0) ||
      isSending ||
      (!mutationsEnabled && replaceRunId === undefined)
    ) {
      return;
    }
    setIsSending(true);
    setErrorMessage(undefined);
    try {
      const intentForeground: ForegroundRunState =
        queueAgainstRunId === undefined
          ? foreground
          : {
              kind: 'active',
              generation: foreground.kind === 'unknown' ? 0 : foreground.generation,
              runId: queueAgainstRunId,
              status: 'running',
            };
      const intent = nextMobileSendIntent({
        sessionId,
        text,
        foreground: intentForeground,
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(turn?.model ? { model: turn.model } : {}),
        ...(turn?.thinkingLevel ? { thinkingLevel: turn.thinkingLevel } : {}),
        ...(replaceRunId === undefined ? {} : { replaceRunId }),
        ...(shouldIncludeAppleHealthOnSend({
          healthEnabled:
            healthConnected &&
            healthUseMode !== 'off' &&
            hostSupportsClientTools &&
            healthExecutorUsable({
              nativeAvailable: healthNativeAvailable,
              production: import.meta.env.PROD === true,
              allowFake: import.meta.env.DEV === true,
            }),
          includeAppleHealth,
        })
          ? { includeAppleHealth: true }
          : {}),
      });
      if (intent.kind === 'disabled') {
        return;
      }
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        intent.command,
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        if (
          clientRef.current !== client ||
          activeSessionRef.current !== sessionId ||
          selectionGenerationRef.current !== selectionGeneration
        ) {
          return;
        }
        const failure = readMobilePromptFailure(response);
        setErrorMessage(failure?.message ?? response.error);
        setPendingReplaceRunId(failure?.replaceRunId);
        if (turn?.text !== undefined) {
          setComposerText(turn.text);
        }
        return;
      }
      if (
        clientRef.current !== client ||
        activeSessionRef.current !== sessionId ||
        selectionGenerationRef.current !== selectionGeneration
      ) {
        return;
      }
      setPendingReplaceRunId(undefined);
      setPausedCheckpointId(undefined);
      const runId = readRunId(response.data);
      if (runId !== undefined) {
        setForeground((current) => {
          if (
            clientRef.current !== client ||
            activeSessionRef.current !== sessionId ||
            selectionGenerationRef.current !== selectionGeneration
          ) {
            return current;
          }
          return applyHostPushToForeground(
            current,
            {
              type: 'run/updated',
              run: {
                runId,
                kind: 'session-turn',
                status: 'running',
                rootRunId: runId,
                sessionId,
              },
            },
            sessionId,
          );
        });
      }
      setComposerText('');
      setAttachments([]);
      const messagesResponse = await client.request({ type: 'session/messages', sessionId });
      if (
        clientRef.current !== client ||
        activeSessionRef.current !== sessionId ||
        selectionGenerationRef.current !== selectionGeneration
      ) {
        return;
      }
      setMessages((current) => {
        const remote = readSessionMessages(messagesResponse);
        const inFlight = current.filter(
          (msg) => msg.status === 'streaming' && !remote.some((r) => r.id === msg.id),
        );
        return [...remote, ...inFlight];
      });
    } catch (error) {
      if (
        clientRef.current === client &&
        activeSessionRef.current === sessionId &&
        selectionGenerationRef.current === selectionGeneration
      ) {
        setErrorMessage(toError(error, '发送消息失败。').message);
        if (turn?.text !== undefined) {
          setComposerText(turn.text);
        }
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleQueueAndSend = async (): Promise<void> => {
    const runId = pendingReplaceRunId;
    if (runId === undefined) {
      return;
    }
    setPendingReplaceRunId(undefined);
    await handleSend(undefined, undefined, runId);
  };

  const handleDismissBusy = (): void => {
    setPendingReplaceRunId(undefined);
    setErrorMessage(undefined);
  };

  const handleAbort = async (target?: { sessionId: string; runId?: string }): Promise<void> => {
    const client = clientRef.current;
    const sessionId = target?.sessionId ?? activeSessionRef.current;
    const runId = target === undefined ? activeRunId : target.runId;
    if (client === undefined || sessionId === undefined || runId === undefined || !mutationsEnabled) {
      return;
    }
    const error = await abortMobileRun(client, sessionId, runId);
    if (error !== undefined) {
      setErrorMessage(error);
      return;
    }
    void refreshActivitySummary(client);
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    if (file === undefined || client === undefined || sessionId === undefined) {
      return;
    }
    setIsUploadingMedia(true);
    setErrorMessage(undefined);
    try {
      const result = await uploadMobileImage(client, sessionId, file);
      if (result.ok) {
        setAttachments((current) => [...current, result.attachment]);
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleResolvePermission = async (
    decision: 'allow' | 'deny',
    requestId?: string,
    rememberScope: 'once' | 'session' | 'project' = 'once',
  ): Promise<boolean> => {
    const client = clientRef.current;
    const resolvedRequestId = requestId ?? permissionRequest?.requestId;
    if (client === undefined || resolvedRequestId === undefined || isResolvingPermission) {
      return false;
    }
    setIsResolvingPermission(true);
    setErrorMessage(undefined);
    try {
      const error = await resolveMobilePermission(client, resolvedRequestId, decision, rememberScope);
      if (error !== undefined) {
        setErrorMessage(error);
        return false;
      }
      setPermissionRequest((current) =>
        current?.requestId === resolvedRequestId ? undefined : current,
      );
      void refreshActivitySummary(client);
      return true;
    } finally {
      setIsResolvingPermission(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };



  return {
    /** The connected HostClient is the shared authority for chat and Live. */
    client: clientRef.current,
    endpoint,
    setEndpoint,
    authToken,
    setAuthToken,
    pairingToken,
    setPairingToken,
    expectedHostInstanceId,
    setExpectedHostInstanceId,
    connectionState,
    hostStatus,
    artifactEnabled,
    projects,
    sessions,
    activityItems,
    knowledgeBases,
    wikiOverview,
    knowledgeError,
    activeSessionId,
    messages,
    composerText,
    setComposerText,
    activeRunId,
    mutationsEnabled,
    pausedCheckpointId,
    permissionRequest,
    attachments,
    removeAttachment,
    isSending,
    isUploadingMedia,
    isResolvingPermission,
    errorMessage,
    setErrorMessage,
    pendingReplaceRunId,
    credentialPersistError,
    isNativeVault: isNativeTauriRuntime(),
    configuredModels,
    defaultProviderId,
    defaultModelId,
    handleConnect,
    handleDisconnect,
    refreshActivitySummary: () => {
      if (clientRef.current !== undefined) void refreshActivitySummary(clientRef.current);
    },
    retryCredentialPersist,
    handleSelectSession,
    handleCreateSession,
    handlePinSession,
    handleRenameSession,
    handleDeleteSession,
    handleSend,
    handleQueueAndSend,
    handleDismissBusy,
    handleAbort,
    handleFileSelected,
    handleResolvePermission,
    refreshKnowledge: () => {
      if (clientRef.current !== undefined) void refreshKnowledge(clientRef.current);
    },
    handleKnowledgeSearch,
    handleOpenKnowledgeSource,
    handleSetSessionKnowledgeBases,
    handleAddKnowledgeBase,
    handleDistillWiki,
    loadMoreSessions: () => {
      if (clientRef.current !== undefined) void sessionListSync.loadMore(clientRef.current);
    },
    healthEnabled,
    healthAvailable: hostSupportsClientTools && healthExecutorUsable({
      nativeAvailable: healthNativeAvailable,
      production: import.meta.env.PROD === true,
      allowFake: import.meta.env.DEV === true,
    }),
    healthConnected,
    healthUseMode,
    includeAppleHealth,
    setIncludeAppleHealth,
    healthConsentRequest,
    healthAlwaysAllowUnlocked,
    handleConnectAppleHealth,
    handleDisconnectAppleHealth,
    handleChangeHealthUseMode,
    resolveHealthConsent,
  };
}
