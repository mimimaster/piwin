import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  ActivitySummaryItem,
  ConfiguredChatModel,
  MediaAttachmentRef,
  ModelRef,
  RemoteHostStatusData,
  RemoteProjectSummary,
  RemoteSessionSummary,
  ThinkingLevel,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import { HostClient, type HostClientState } from '@piwin/host-client';
import {
  createMobileHostClient,
  getDefaultHostEndpoint,
} from '../mobile-host-connection.js';
import {
  createMemoryMobileDeviceCredentialVault,
  createTauriMobileDeviceCredentialVault,
  isNativeTauriRuntime,
  type MobileDeviceCredentialVault,
} from '../mobile-device-credential-vault.js';
import {
  applyConfiguredModels,
  applyHostStatus,
  readPauseCheckpointId,
  readProjects,
  readRemoteMediaAsset,
  readRunId,
  readSessions,
} from '../mobile-host-readers.js';
import { buildMobileSessionPrompt, readMobilePromptFailure } from '../mobile-prompt-send.js';
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
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
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

  const clientRef = useRef<HostClient | undefined>(undefined);
  const activeSessionRef = useRef<string | undefined>(undefined);
  const initialConnectInFlightRef = useRef(false);
  const unsubscribeRef = useRef<Array<() => void>>([]);
  const vaultRef = useRef<MobileDeviceCredentialVault>(createMobileVault());
  const deviceCredentialRef = useRef<TrustedDeviceCredential | undefined>(undefined);
  const activityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void handleConnect();
    return () => {
      disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef);
    };
  }, []);

  const refreshActivitySummary = async (client: HostClient): Promise<void> => {
    const summary = await requestActivitySummary(client);
    if (clientRef.current !== client) {
      return;
    }
    setActivityItems(summary.items);
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

    disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef);
    setErrorMessage(undefined);
    setPendingReplaceRunId(undefined);
    setHostStatus(undefined);
    setProjects([]);
    setSessions([]);
    setActivityItems([]);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setActiveRunId(undefined);
    setPausedCheckpointId(undefined);
    setAttachments([]);

    if (deviceCredentialRef.current === undefined) {
      deviceCredentialRef.current = await vaultRef.current.read(normalizedEndpoint);
    }

    const client = createMobileHostClient(normalizedEndpoint, {
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
    });
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
          setActiveRunId,
          setPausedCheckpointId,
          setPermissionRequest,
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
    disposeClient(clientRef, unsubscribeRef, activityRefreshTimerRef);
    setConnectionState({ kind: 'disconnected' });
    setHostStatus(undefined);
    setProjects([]);
    setSessions([]);
    setActivityItems([]);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setActiveRunId(undefined);
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
    setActiveRunId(undefined);
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
        return;
      }
      const messagesResponse = await client.request({ type: 'session/messages', sessionId });
      setMessages(readSessionMessages(messagesResponse));
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
      const response = await client.request({
        type: 'session/create',
        input: {
          sessionName: 'Mobile session',
          ...(projectId === undefined || projectId.length === 0
            ? { scope: { kind: 'general' as const } }
            : { projectId }),
        },
      });
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
  ): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    const text = (turn?.text ?? composerText).trim();
    if (client === undefined || sessionId === undefined || (text.length === 0 && attachments.length === 0) || isSending) {
      return;
    }
    setIsSending(true);
    setErrorMessage(undefined);
    try {
      if (pausedCheckpointId !== undefined) {
        const clearPause = await client.request({
          type: 'session/abort',
          sessionId,
        });
        if (!clearPause.success) {
          setErrorMessage(clearPause.error);
          return;
        }
        setPausedCheckpointId(undefined);
      }
      const response = await client.request(
        buildMobileSessionPrompt({
          sessionId,
          text,
          ...(attachments.length === 0 ? {} : { attachments }),
          ...(turn?.model ? { model: turn.model } : {}),
          ...(turn?.thinkingLevel ? { thinkingLevel: turn.thinkingLevel } : {}),
          ...(replaceRunId === undefined ? {} : { replaceRunId }),
        }),
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
      const runId = readRunId(response.data);
      setActiveRunId(runId);
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

  const handleAbort = async (target?: { sessionId: string; runId?: string }): Promise<void> => {
    const client = clientRef.current;
    const sessionId = target?.sessionId ?? activeSessionRef.current;
    const runId = target === undefined ? activeRunId : target.runId;
    if (client === undefined || sessionId === undefined) {
      return;
    }
    try {
      const response = await client.request({
        type: 'session/abort',
        sessionId,
        ...(runId === undefined ? {} : { runId }),
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      if (runId === undefined && response.data && isRecord(response.data)) {
        if (response.data.reason === 'no-active-run') {
          setPausedCheckpointId(undefined);
        }
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
      const response = await client.request({
        type: 'permission/resolve',
        requestId: resolvedRequestId,
        decision,
        rememberScope: 'once',
      });
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

  return {
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
    projects,
    sessions,
    activityItems,
    activeSessionId,
    messages,
    composerText,
    setComposerText,
    activeRunId,
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
    handleAbort,
    handleFileSelected,
    handleResolvePermission,
  };
}

function createMobileVault(): MobileDeviceCredentialVault {
  if (!isNativeTauriRuntime()) {
    return createMemoryMobileDeviceCredentialVault();
  }
  return createTauriMobileDeviceCredentialVault(async (command, args) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  });
}

function disposeClient(
  clientRef: { current: HostClient | undefined },
  unsubscribeRef: { current: Array<() => void> },
  activityRefreshTimerRef?: { current: ReturnType<typeof setTimeout> | undefined },
): void {
  if (activityRefreshTimerRef?.current !== undefined) {
    clearTimeout(activityRefreshTimerRef.current);
    activityRefreshTimerRef.current = undefined;
  }
  for (const unsubscribe of unsubscribeRef.current) {
    unsubscribe();
  }
  unsubscribeRef.current = [];
  const client = clientRef.current;
  clientRef.current = undefined;
  if (client !== undefined) {
    void client.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toError(error: unknown, fallback: string = '未知错误'): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to read selected image'));
        return;
      }
      const separatorIndex = reader.result.indexOf(',');
      if (separatorIndex < 0) {
        reject(new Error('Selected image has an invalid data URL'));
        return;
      }
      resolve(reader.result.slice(separatorIndex + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read selected image'));
    reader.readAsDataURL(file);
  });
}
