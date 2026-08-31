import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  ActivitySummaryItem,
  ClientToolRequestFrame,
  ConfiguredChatModel,
  MediaAttachmentRef,
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
  type HealthForegroundUseMode,
} from '../client-tools/client-tool-preferences.js';
import type { MobileClientToolConsentDecision } from '../client-tools/mobile-client-tool-runtime.js';
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
  writeForegroundUseMode,
  writeHealthConnectedSetting,
} from '../client-tools/mobile-health-session.js';
import {
  healthkitIsAvailable,
  healthkitRequestReadAuthorization,
} from '../health/native-healthkit.js';
import {
  createMobileHostClient,
  getDefaultHostEndpoint,
} from '../mobile-host-connection.js';
import {
  readMobileDeviceCredential,
  isNativeTauriRuntime,
  type MobileDeviceCredentialVault,
} from '../mobile-device-credential-vault.js';
import {
  createMobileVault,
  disposeClient,
  isRecord,
  readFileAsBase64,
  toError,
} from '../mobile-host-helpers.js';
import {
  applyConfiguredModels,
  applyHostStatus,
  readArtifactEnabled,
  readPauseCheckpointId,
  readProjects,
  readRemoteMediaAsset,
  readRunId,
  readSessions,
} from '../mobile-host-readers.js';
import {
  createMobileIdempotencyKey,
  executeMobileMutation,
  nextMobileSendIntent,
  readMobilePromptFailure,
  buildMobileAbortCommand,
  buildMobilePermissionResolveCommand,
} from '../mobile-prompt-send.js';
import {
  ACTIVITY_SUMMARY_REFRESH_DEBOUNCE_MS,
  requestActivitySummary,
  shouldRefreshActivitySummary,
} from '../mobile-activity-summary.js';
import {
  handleRemotePush,
  readSessionMessages,
  type MobileMediaAttachment,
  type MobileTranscriptMessage,
  type MobileToolCall,
  type RemotePermissionRequest,
} from '../mobile-transcript.js';

export type { MobileMediaAttachment, MobileToolCall, MobileTranscriptMessage, RemotePermissionRequest };

const MAX_MOBILE_IMAGE_BYTES = 700_000;
const MOBILE_SESSION_LIST_MAX_ITEMS = 80;
const MOBILE_DEVICE_NAME = 'Piwin mobile';

function mobileSessionListCommand(): {
  type: 'session/list';
  allScopes: true;
  order: 'updated';
  maxItems: number;
} {
  return {
    type: 'session/list',
    allScopes: true,
    order: 'updated',
    maxItems: MOBILE_SESSION_LIST_MAX_ITEMS,
  };
}

export function useMobileHost() {
  const [endpoint, setEndpoint] = useState(getDefaultHostEndpoint);
  const [authToken, setAuthToken] = useState('');
  const [pairingToken, setPairingToken] = useState('');
  const [expectedHostInstanceId, setExpectedHostInstanceId] = useState<string | undefined>();
  const [connectionState, setConnectionState] = useState<HostClientState>({ kind: 'idle' });
  const [hostStatus, setHostStatus] = useState<RemoteHostStatusData | undefined>();
  const [projects, setProjects] = useState<RemoteProjectSummary[]>([]);
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
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
  const [healthNativeAvailable, setHealthNativeAvailable] = useState(false);
  const [healthConnected, setHealthConnected] = useState(readHealthConnectedSetting);
  const [healthUseMode, setHealthUseMode] = useState<HealthForegroundUseMode>('ask-every-time');
  const [includeAppleHealth, setIncludeAppleHealth] = useState(false);
  const [hostSupportsClientTools, setHostSupportsClientTools] = useState(false);
  const [healthConsentRequest, setHealthConsentRequest] = useState<ClientToolRequestFrame | undefined>();
  const [healthAlwaysAllowUnlocked, setHealthAlwaysAllowUnlocked] = useState(false);

  const clientRef = useRef<HostClient | undefined>(undefined);
  const activeSessionRef = useRef<string | undefined>(undefined);
  const selectionGenerationRef = useRef(0);
  const initialConnectInFlightRef = useRef(false);
  const unsubscribeRef = useRef<Array<() => void>>([]);
  const vaultRef = useRef<MobileDeviceCredentialVault>(createMobileVault());
  const deviceCredentialRef = useRef<TrustedDeviceCredential | undefined>(undefined);
  const activityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const healthRuntimeRef = useRef<MobileClientToolRuntime | undefined>(undefined);
  const healthPreferencesRef = useRef<ClientToolPreferenceStore>(createLocalClientToolPreferenceStore());
  const healthScopeKeyRef = useRef<string | undefined>(undefined);
  const healthConsentResolverRef = useRef<
    ((decision: MobileClientToolConsentDecision) => void) | undefined
  >(undefined);

  useEffect(() => {
    void handleConnect();
    return () => {
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

  const beginSessionForeground = async (client: HostClient, sessionId: string): Promise<void> => {
    const generation = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = generation;
    setForeground(reduceForegroundRun(initialForegroundRunState(), { type: 'begin-reconcile', generation }, sessionId));
    if (typeof client.updateSubscriptions === 'function') {
      try {
        await client.updateSubscriptions([sessionId]);
      } catch {
        // Subscriptions are best-effort; foreground-run still gates Send.
      }
    }
    const response = await client.request({ type: 'session/foreground-run', sessionId });
    if (clientRef.current !== client || activeSessionRef.current !== sessionId) {
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

  const refreshRemoteReadModel = async (client: HostClient): Promise<void> => {
    try {
      const [statusResponse, projectsResponse, sessionsResponse, modelsResponse, activitySummary] =
        await Promise.all([
          client.request({ type: 'host/status' }),
          client.request({ type: 'project/list' }),
          client.request(mobileSessionListCommand()),
          client.request({ type: 'models/configured' }),
          requestActivitySummary(client),
        ]);
      if (clientRef.current !== client) {
        return;
      }
      applyHostStatus(statusResponse, setHostStatus, setErrorMessage);
      setProjects(readProjects(projectsResponse));
      const sessionList = readSessions(sessionsResponse);
      setSessions(sessionList);
      applyConfiguredModels(modelsResponse, setConfiguredModels, setDefaultProviderId, setDefaultModelId);
      setActivityItems(activitySummary.items);
      try {
        const settingsResponse = await client.request({ type: 'settings/get' });
        if (clientRef.current === client) {
          setArtifactEnabled(readArtifactEnabled(settingsResponse));
        }
      } catch {
        if (clientRef.current === client) {
          setArtifactEnabled(true);
        }
      }

      let targetSessionId = activeSessionRef.current;
      if (targetSessionId === undefined && sessionList.length > 0 && sessionList[0] !== undefined) {
        targetSessionId = sessionList[0].sessionId;
        activeSessionRef.current = targetSessionId;
        setActiveSessionId(targetSessionId);
      }

      if (targetSessionId !== undefined) {
        const resumeResponse = await client.request({ type: 'session/resume', sessionId: targetSessionId });
        if (clientRef.current === client && resumeResponse.success) {
          setMessages(readSessionMessages(resumeResponse));
          setPausedCheckpointId(readPauseCheckpointId(resumeResponse.data));
        }
        if (clientRef.current === client) {
          await beginSessionForeground(client, targetSessionId);
        }
      }
    } catch (error) {
      if (clientRef.current === client) {
        setErrorMessage(toError(error, '刷新 Host 状态失败。').message);
      }
    }
  };

  const handleConnect = async (): Promise<void> => {
    const normalizedEndpoint = endpoint.trim();
    if (normalizedEndpoint.length === 0) {
      setErrorMessage('请输入 Host 的 WebSocket 地址。');
      return;
    }

    const pairing = pairingToken.trim();
    const door = authToken.trim();
    if (pairing.length > 0 && door.length > 0) {
      setErrorMessage('请只填写配对令牌或 Host 口令其中一项。');
      return;
    }

    disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef, healthRuntimeRef);
    setErrorMessage(undefined);
    setPendingReplaceRunId(undefined);
    setHostStatus(undefined);
    setArtifactEnabled(true);
    setProjects([]);
    setSessions([]);
    setActivityItems([]);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setForeground(initialForegroundRunState());
    setPausedCheckpointId(undefined);
    setAttachments([]);

    if (deviceCredentialRef.current === undefined) {
      deviceCredentialRef.current = await readMobileDeviceCredential(
        vaultRef.current,
        normalizedEndpoint,
      );
    }

    const nativeAvailable = await healthkitIsAvailable();
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
          deviceCredentialRef.current = issued;
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
      }),
    );

    try {
      await client.connect();
      if (pairing.length > 0) {
        setPairingToken('');
      }
      const connectedInstanceId = client.getCursor().hostInstanceId;
      if (
        expectedHostInstanceId !== undefined &&
        connectedInstanceId !== undefined &&
        expectedHostInstanceId !== connectedInstanceId
      ) {
        setErrorMessage('Host 实例标识与配对码不一致。设备凭证仍然有效；若连错机器请重新扫码。');
      }
      await refreshRemoteReadModel(client);
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
    } catch (error) {
      setErrorMessage(toError(error, '连接 Host 失败。').message);
    } finally {
      initialConnectInFlightRef.current = false;
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    initialConnectInFlightRef.current = false;
    try {
      await vaultRef.current.clear(endpoint.trim());
    } catch {
      // Clearing the local vault must not block disconnect.
    }
    deviceCredentialRef.current = undefined;
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
    activeSessionRef.current = sessionId;
    setActiveSessionId(sessionId);
    setPausedCheckpointId(undefined);
    setPermissionRequest(undefined);
    setAttachments([]);
    setErrorMessage(undefined);
    setPendingReplaceRunId(undefined);
    try {
      const resumeResponse = await client.request({ type: 'session/resume', sessionId });
      if (resumeResponse.success) {
        setMessages(readSessionMessages(resumeResponse));
        setPausedCheckpointId(readPauseCheckpointId(resumeResponse.data));
        await beginSessionForeground(client, sessionId);
        return;
      }
      const messagesResponse = await client.request({ type: 'session/messages', sessionId });
      setMessages(readSessionMessages(messagesResponse));
      await beginSessionForeground(client, sessionId);
    } catch (error) {
      setErrorMessage(toError(error, '读取会话消息失败。').message);
    }
  };

  const handleCreateSession = async (projectId?: string): Promise<string | undefined> => {
    const client = clientRef.current;
    if (client === undefined) {
      return undefined;
    }
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        {
          type: 'session/create',
          input: {
            sessionName: 'Mobile session',
            ...(projectId === undefined || projectId.length === 0
              ? { scope: { kind: 'general' as const } }
              : { projectId }),
          },
        },
        createMobileIdempotencyKey(),
      );
      if (
        !response.success ||
        !isRecord(response.data) ||
        typeof response.data.sessionId !== 'string'
      ) {
        setErrorMessage(response.success ? 'Host 未返回新会话 ID。' : response.error);
        return undefined;
      }
      const newSessionId = response.data.sessionId;
      const nextSessionsResponse = await client.request(mobileSessionListCommand());
      const nextSessions = readSessions(nextSessionsResponse);
      setSessions(nextSessions);
      await handleSelectSession(newSessionId);
      return newSessionId;
    } catch (error) {
      setErrorMessage(toError(error, '创建会话失败。').message);
      return undefined;
    }
  };

  const handlePinSession = async (sessionId: string, isPinned: boolean): Promise<void> => {
    const client = clientRef.current;
    if (client === undefined) return;
    try {
      await client.request({
        type: isPinned ? 'session/unpin' : 'session/pin',
        sessionId,
      });
      const nextSessionsResponse = await client.request(mobileSessionListCommand());
      setSessions(readSessions(nextSessionsResponse));
    } catch (error) {
      setErrorMessage(toError(error, '置顶操作失败。').message);
    }
  };

  const handleRenameSession = async (sessionId: string, newName: string): Promise<void> => {
    const client = clientRef.current;
    if (client === undefined || !newName.trim()) return;
    try {
      await client.request({
        type: 'session/rename',
        sessionId,
        name: newName.trim(),
      });
      const nextSessionsResponse = await client.request(mobileSessionListCommand());
      setSessions(readSessions(nextSessionsResponse));
    } catch (error) {
      setErrorMessage(toError(error, '重命名失败。').message);
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    const client = clientRef.current;
    if (client === undefined) return;
    try {
      await client.request({
        type: 'session/archive',
        sessionId,
      });
      const nextSessionsResponse = await client.request(mobileSessionListCommand());
      const nextSessions = readSessions(nextSessionsResponse);
      setSessions(nextSessions);
      if (activeSessionId === sessionId) {
        if (nextSessions.length > 0 && nextSessions[0] !== undefined) {
          await handleSelectSession(nextSessions[0].sessionId);
        } else {
          setActiveSessionId(undefined);
          setMessages([]);
        }
      }
    } catch (error) {
      setErrorMessage(toError(error, '删除会话失败。').message);
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
        const failure = readMobilePromptFailure(response);
        setErrorMessage(failure?.message ?? response.error);
        setPendingReplaceRunId(failure?.replaceRunId);
        if (turn?.text !== undefined) {
          setComposerText(turn.text);
        }
        return;
      }
      setPendingReplaceRunId(undefined);
      setPausedCheckpointId(undefined);
      const runId = readRunId(response.data);
      if (runId !== undefined) {
        setForeground((current) =>
          applyHostPushToForeground(
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
          ),
        );
      }
      setComposerText('');
      setAttachments([]);
      const messagesResponse = await client.request({ type: 'session/messages', sessionId });
      setMessages(readSessionMessages(messagesResponse));
    } catch (error) {
      setErrorMessage(toError(error, '发送消息失败。').message);
      if (turn?.text !== undefined) {
        setComposerText(turn.text);
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
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        buildMobileAbortCommand(sessionId, runId),
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      void refreshActivitySummary(client);
    } catch (error) {
      setErrorMessage(toError(error, '停止运行失败。').message);
    }
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    if (file === undefined || client === undefined || sessionId === undefined) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setErrorMessage('移动端暂时只支持图片附件。');
      return;
    }
    if (file.size > MAX_MOBILE_IMAGE_BYTES) {
      setErrorMessage('图片过大，请先压缩到 700 KB 以内。');
      return;
    }
    setIsUploadingMedia(true);
    setErrorMessage(undefined);
    try {
      const base64Data = await readFileAsBase64(file);
      const response = await client.request({
        type: 'media/save',
        input: {
          sessionId,
          mimeType: file.type,
          source: 'file-picker',
          base64Data,
        },
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      const asset = readRemoteMediaAsset(response.data);
      if (asset === undefined) {
        setErrorMessage('Host 未返回可用的图片资产。');
        return;
      }
      const newAttachment: MediaAttachmentRef = {
        id: asset.id,
        kind: 'media',
        path: `remote-asset:${asset.id}`,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        source: 'file-picker',
        ...(asset.name !== undefined ? { name: asset.name } : {}),
        ...(asset.contentKind !== undefined ? { contentKind: asset.contentKind } : {}),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
      };
      setAttachments((current) => [...current, newAttachment]);
    } catch (error) {
      setErrorMessage(toError(error, '上传图片失败。').message);
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleResolvePermission = async (
    decision: 'allow' | 'deny',
    requestId?: string,
  ): Promise<void> => {
    const client = clientRef.current;
    const resolvedRequestId = requestId ?? permissionRequest?.requestId;
    if (client === undefined || resolvedRequestId === undefined || isResolvingPermission) {
      return;
    }
    setIsResolvingPermission(true);
    setErrorMessage(undefined);
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        buildMobilePermissionResolveCommand(resolvedRequestId, decision),
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      setPermissionRequest((current) =>
        current?.requestId === resolvedRequestId ? undefined : current,
      );
      void refreshActivitySummary(client);
    } catch (error) {
      setErrorMessage(toError(error, '处理权限请求失败。').message);
    } finally {
      setIsResolvingPermission(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };

  const healthEnabled =
    healthConnected &&
    healthUseMode !== 'off' &&
    hostSupportsClientTools &&
    healthExecutorUsable({
      nativeAvailable: healthNativeAvailable,
      production: import.meta.env.PROD === true,
      allowFake: import.meta.env.DEV === true,
    });

  const handleConnectAppleHealth = async (): Promise<void> => {
    const runtime = healthRuntimeRef.current;
    if (runtime === undefined || clientRef.current === undefined) {
      return;
    }
    if (healthNativeAvailable) {
      try {
        await healthkitRequestReadAuthorization();
      } catch (error) {
        setErrorMessage(toError(error, 'Apple Health 授权失败。').message);
        return;
      }
    } else if (import.meta.env.PROD === true) {
      setErrorMessage('当前设备不支持 Apple Health。');
      return;
    }
    writeHealthConnectedSetting(true);
    setHealthConnected(true);
    if (healthUseMode === 'off') {
      setHealthUseMode('ask-every-time');
      const scopeKey = healthScopeKeyRef.current;
      if (scopeKey !== undefined) {
        writeForegroundUseMode(healthPreferencesRef.current, scopeKey, 'ask-every-time');
      }
    }
    runtime.setHealthEnabled(true);
    await advertiseMobileHealthRuntime(runtime);
  };

  const handleDisconnectAppleHealth = async (): Promise<void> => {
    const runtime = healthRuntimeRef.current;
    writeHealthConnectedSetting(false);
    setHealthConnected(false);
    setIncludeAppleHealth(false);
    if (runtime !== undefined) {
      runtime.setHealthEnabled(false);
      await advertiseMobileHealthRuntime(runtime);
    }
    const scopeKey = healthScopeKeyRef.current;
    if (scopeKey !== undefined) {
      healthPreferencesRef.current.clear(scopeKey);
    }
    setHealthUseMode('ask-every-time');
  };

  const handleChangeHealthUseMode = (mode: HealthForegroundUseMode): void => {
    setHealthUseMode(mode);
    const scopeKey = healthScopeKeyRef.current;
    if (scopeKey !== undefined) {
      writeForegroundUseMode(healthPreferencesRef.current, scopeKey, mode);
    }
    const runtime = healthRuntimeRef.current;
    if (runtime === undefined) {
      return;
    }
    runtime.setHealthEnabled(mode !== 'off' && healthConnected);
    void advertiseMobileHealthRuntime(runtime);
  };

  const resolveHealthConsent = (decision: MobileClientToolConsentDecision): void => {
    const resolve = healthConsentResolverRef.current;
    healthConsentResolverRef.current = undefined;
    setHealthConsentRequest(undefined);
    resolve?.(decision);
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
      const client = clientRef.current;
      if (client !== undefined) {
        void refreshActivitySummary(client);
      }
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
