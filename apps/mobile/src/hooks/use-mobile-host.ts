import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type {
  ConfiguredChatModel,
  ConfiguredChatModelsData,
  HostPush,
  HostResponse,
  MediaAttachmentRef,
  ModelRef,
  RemoteHostStatusData,
  RemoteMediaAsset,
  RemoteProjectSummary,
  RemoteSessionSummary,
  RemoteTranscriptMessage,
  ThinkingLevel,
} from '@piwin/contracts';
import { isThinkingLevel } from '@piwin/contracts';
import { HostClient, type HostClientState } from '@piwin/host-client';
import {
  createMobileHostClient,
  getDefaultHostEndpoint,
  isRemoteHostStatusData,
} from '../mobile-host-connection.js';

export type ResponseRecord = Record<string, unknown>;

export type MobileMediaAttachment = MediaAttachmentRef;

export type RemotePermissionRequest = Extract<HostPush, { type: 'permission/request' }>;

export type MobileToolCall = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string | undefined;
  actionVerb?: string | undefined;
  command?: string | undefined;
  targetPaths?: string[] | undefined;
  output?: string | undefined;
  error?: string | undefined;
  durationMs?: number | undefined;
};

export type MobileTranscriptMessage = RemoteTranscriptMessage & {
  thinking?: string | undefined;
  toolCalls?: MobileToolCall[] | undefined;
  attachments?: MobileMediaAttachment[] | undefined;
};

const MAX_MOBILE_IMAGE_BYTES = 700_000;
const MOBILE_SESSION_LIST_MAX_ITEMS = 80;

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
  const [configuredModels, setConfiguredModels] = useState<ConfiguredChatModel[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | undefined>();
  const [defaultModelId, setDefaultModelId] = useState<string | undefined>();

  const clientRef = useRef<HostClient | undefined>(undefined);
  const activeSessionRef = useRef<string | undefined>(undefined);
  const initialConnectInFlightRef = useRef(false);
  const unsubscribeRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    void handleConnect();
    return () => {
      disposeClient(clientRef, unsubscribeRef);
    };
  }, []);

  const refreshRemoteReadModel = async (client: HostClient): Promise<void> => {
    try {
      const [statusResponse, projectsResponse, sessionsResponse, modelsResponse] = await Promise.all([
        client.request({ type: 'host/status' }),
        client.request({ type: 'project/list' }),
        client.request(mobileSessionListCommand()),
        client.request({ type: 'models/configured' }),
      ]);
      if (clientRef.current !== client) {
        return;
      }
      applyHostStatus(statusResponse, setHostStatus, setErrorMessage);
      setProjects(readProjects(projectsResponse));
      const sessionList = readSessions(sessionsResponse);
      setSessions(sessionList);
      applyConfiguredModels(modelsResponse, setConfiguredModels, setDefaultProviderId, setDefaultModelId);

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

    disposeClient(clientRef, unsubscribeRef);
    setErrorMessage(undefined);
    setHostStatus(undefined);
    setProjects([]);
    setSessions([]);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setActiveRunId(undefined);
    setPausedCheckpointId(undefined);
    setAttachments([]);

    const client = createMobileHostClient(normalizedEndpoint, authToken.trim());
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
      client.subscribePush((push) =>
        handleRemotePush(
          push,
          activeSessionRef,
          setMessages,
          setActiveRunId,
          setPausedCheckpointId,
          setPermissionRequest,
        ),
      ),
    );

    try {
      await client.connect();
      await refreshRemoteReadModel(client);
    } catch (error) {
      setErrorMessage(toError(error, '连接 Host 失败。').message);
    } finally {
      initialConnectInFlightRef.current = false;
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    initialConnectInFlightRef.current = false;
    disposeClient(clientRef, unsubscribeRef);
    setConnectionState({ kind: 'disconnected' });
    setHostStatus(undefined);
    setProjects([]);
    setSessions([]);
    setActiveSessionId(undefined);
    activeSessionRef.current = undefined;
    setMessages([]);
    setActiveRunId(undefined);
    setPausedCheckpointId(undefined);
    setPermissionRequest(undefined);
    setAttachments([]);
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

  const handleSend = async (turn?: {
    model?: ModelRef;
    thinkingLevel?: ThinkingLevel;
  }): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    const text = composerText.trim();
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
      const response = await client.request({
        type: 'session/prompt',
        sessionId,
        input: {
          text,
          ...(attachments.length === 0 ? {} : { attachments }),
          ...(turn?.model ? { model: turn.model } : {}),
          ...(turn?.thinkingLevel ? { thinkingLevel: turn.thinkingLevel } : {}),
        },
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      const runId = readRunId(response.data);
      setActiveRunId(runId);
      setComposerText('');
      setAttachments([]);
      const messagesResponse = await client.request({ type: 'session/messages', sessionId });
      setMessages(readSessionMessages(messagesResponse));
    } catch (error) {
      setErrorMessage(toError(error, '发送消息失败。').message);
    } finally {
      setIsSending(false);
    }
  };

  const handleAbort = async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    if (client === undefined || sessionId === undefined) {
      return;
    }
    try {
      const response = await client.request({
        type: 'session/abort',
        sessionId,
        ...(activeRunId === undefined ? {} : { runId: activeRunId }),
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      if (activeRunId === undefined && response.data && isRecord(response.data)) {
        if (response.data.reason === 'no-active-run') {
          setPausedCheckpointId(undefined);
        }
      }
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

  const handleResolvePermission = async (decision: 'allow' | 'deny'): Promise<void> => {
    const client = clientRef.current;
    const request = permissionRequest;
    if (client === undefined || request === undefined || isResolvingPermission) {
      return;
    }
    setIsResolvingPermission(true);
    setErrorMessage(undefined);
    try {
      const response = await client.request({
        type: 'permission/resolve',
        requestId: request.requestId,
        decision,
        rememberScope: 'once',
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      setPermissionRequest(undefined);
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
    connectionState,
    hostStatus,
    projects,
    sessions,
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
    configuredModels,
    defaultProviderId,
    defaultModelId,
    handleConnect,
    handleDisconnect,
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

function applyHostStatus(
  response: HostResponse,
  setStatus: (status: RemoteHostStatusData) => void,
  setError: (message: string | undefined) => void,
): void {
  if (!response.success) {
    setError(response.error);
    return;
  }
  if (!isRemoteHostStatusData(response.data)) {
    setError('Host 返回了无法识别的状态数据。');
    return;
  }
  setStatus(response.data);
}

function applyConfiguredModels(
  response: HostResponse,
  setModels: (models: ConfiguredChatModel[]) => void,
  setDefaultProviderId: (providerId: string | undefined) => void,
  setDefaultModelId: (modelId: string | undefined) => void,
): void {
  const data = readConfiguredChatModels(response);
  setModels(data.models);
  setDefaultProviderId(data.defaultProviderId);
  setDefaultModelId(data.defaultModelId);
}

function readConfiguredChatModels(response: HostResponse): ConfiguredChatModelsData {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.models)) {
    return { models: [] };
  }
  const models: ConfiguredChatModel[] = [];
  for (const item of response.data.models) {
    if (!isRecord(item) || typeof item.providerId !== 'string' || typeof item.modelId !== 'string') {
      continue;
    }
    if (
      item.protocol !== 'openai-compatible' &&
      item.protocol !== 'anthropic-compatible' &&
      item.protocol !== 'google-gemini'
    ) {
      continue;
    }
    const model: ConfiguredChatModel = {
      providerId: item.providerId,
      protocol: item.protocol,
      modelId: item.modelId,
    };
    if (typeof item.label === 'string' && item.label.length > 0) {
      model.label = item.label;
    }
    if (isThinkingLevel(item.thinkingLevel)) {
      model.thinkingLevel = item.thinkingLevel;
    }
    if (Array.isArray(item.thinkingLevels)) {
      model.thinkingLevels = item.thinkingLevels.filter(isThinkingLevel);
    }
    if (typeof item.reasoning === 'boolean') {
      model.reasoning = item.reasoning;
    }
    models.push(model);
  }
  const data: ConfiguredChatModelsData = { models };
  if (typeof response.data.defaultProviderId === 'string') {
    data.defaultProviderId = response.data.defaultProviderId;
  }
  if (typeof response.data.defaultModelId === 'string') {
    data.defaultModelId = response.data.defaultModelId;
  }
  return data;
}

function readProjects(response: HostResponse): RemoteProjectSummary[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.projects)) {
    return [];
  }
  return response.data.projects.filter(isRemoteProjectSummary);
}

function readSessions(response: HostResponse): RemoteSessionSummary[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.sessions)) {
    return [];
  }
  return response.data.sessions.filter(isRemoteSessionSummary);
}

function readSessionMessages(response: HostResponse): MobileTranscriptMessage[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.messages)) {
    return [];
  }
  return response.data.messages
    .filter(isRemoteTranscriptMessage)
    .map((raw: unknown) => {
      const msg = raw as Record<string, unknown>;
      const rawTools = msg.tools ?? msg.toolCalls;
      const toolCalls: MobileToolCall[] | undefined = Array.isArray(rawTools)
        ? rawTools.map((rawTool: unknown) => {
            const t = rawTool as Record<string, unknown>;
            const pres = isRecord(t.presentation) ? t.presentation : undefined;
            const outputPres = pres && isRecord(pres.output) ? (pres.output.text as string) : undefined;
            const errorPres = pres && isRecord(pres.error) ? (pres.error.message as string) : undefined;
            return {
              id: typeof t.toolCallId === 'string' ? t.toolCallId : String(t.id || Math.random()),
              name: typeof t.toolName === 'string' ? t.toolName : typeof t.name === 'string' ? t.name : 'tool',
              status: (t.status === 'running' || t.status === 'error' ? t.status : 'done') as 'running' | 'done' | 'error',
              summary: typeof pres?.summary === 'string' ? pres.summary : typeof t.summary === 'string' ? t.summary : undefined,
              actionVerb: typeof pres?.actionVerb === 'string' ? pres.actionVerb : typeof t.actionVerb === 'string' ? t.actionVerb : undefined,
              command: typeof pres?.command === 'string' ? pres.command : typeof t.command === 'string' ? t.command : undefined,
              targetPaths: Array.isArray(pres?.targetPaths) ? (pres.targetPaths as string[]) : Array.isArray(t.targetPaths) ? (t.targetPaths as string[]) : undefined,
              output: outputPres ?? (typeof t.output === 'string' ? t.output : undefined),
              error: errorPres ?? (t.status === 'error' ? '执行失败' : undefined),
              durationMs: typeof pres?.durationMs === 'number' ? pres.durationMs : typeof t.durationMs === 'number' ? t.durationMs : undefined,
            };
          })
        : undefined;

      const projected: MobileTranscriptMessage = {
        ...(msg as unknown as RemoteTranscriptMessage),
        ...(typeof msg.thinking === 'string' ? { thinking: msg.thinking } : {}),
        ...(toolCalls !== undefined ? { toolCalls } : {}),
      };
      return projected;
    });
}

function readRunId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.runId === 'string' ? value.runId : undefined;
}

function readPauseCheckpointId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.pauseCheckpoint)) {
    return undefined;
  }
  return typeof value.pauseCheckpoint.checkpointId === 'string'
    ? value.pauseCheckpoint.checkpointId
    : undefined;
}

function readRemoteMediaAsset(value: unknown): RemoteMediaAsset | undefined {
  if (!isRecord(value) || !isRecord(value.asset)) {
    return undefined;
  }
  const asset = value.asset;
  if (
    typeof asset.id !== 'string' ||
    asset.id.length === 0 ||
    typeof asset.mimeType !== 'string' ||
    typeof asset.byteSize !== 'number' ||
    asset.byteSize < 0
  ) {
    return undefined;
  }
  const projected: RemoteMediaAsset = {
    id: asset.id,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
  };
  if (typeof asset.name === 'string' && asset.name.length > 0) {
    projected.name = asset.name;
  }
  if (
    asset.contentKind === 'image' ||
    asset.contentKind === 'text' ||
    asset.contentKind === 'document'
  ) {
    projected.contentKind = asset.contentKind;
  }
  if (typeof asset.width === 'number' && Number.isFinite(asset.width) && asset.width > 0) {
    projected.width = asset.width;
  }
  if (typeof asset.height === 'number' && Number.isFinite(asset.height) && asset.height > 0) {
    projected.height = asset.height;
  }
  return projected;
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

function handleRemotePush(
  push: HostPush,
  activeSessionRef: { current: string | undefined },
  setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>>,
  setRunId: Dispatch<SetStateAction<string | undefined>>,
  setPausedCheckpointId: Dispatch<SetStateAction<string | undefined>>,
  setPermissionRequest: Dispatch<SetStateAction<RemotePermissionRequest | undefined>>,
): void {
  const activeSessionId = activeSessionRef.current;
  if (push.type === 'permission/request') {
    if (activeSessionId === undefined || push.sessionId === activeSessionId) {
      setPermissionRequest(push);
    }
    return;
  }
  if (activeSessionId === undefined) {
    return;
  }

  if (push.type === 'run/terminal' && push.run.sessionId === activeSessionId) {
    setRunId(undefined);
    setPausedCheckpointId(undefined);
    return;
  }

  if (push.type === 'transcript/append' && push.sessionId === activeSessionId) {
    const candidate = push.message as unknown;
    if (isRemoteTranscriptMessage(candidate)) {
      setMessages((current) => upsertMessage(current, candidate));
    }
    return;
  }

  if (push.type !== 'event' || push.sessionId !== activeSessionId) {
    return;
  }

  const event = push.event;
  if (event.type === 'permission/request') {
    setPermissionRequest({
      type: 'permission/request',
      sessionId: activeSessionId,
      requestId: event.requestId,
      action: event.action,
      detail: event.detail,
      defaultDecision: event.defaultDecision,
      ...(event.context === undefined ? {} : { context: event.context }),
      ...(event.runId === undefined ? {} : { runId: event.runId }),
    });
    return;
  }
  if (event.type === 'permission/resolved') {
    setPermissionRequest((current) =>
      current?.requestId === event.requestId ? undefined : current,
    );
  }
  if (event.type === 'message/start') {
    const message: MobileTranscriptMessage = {
      id: event.messageId,
      role: event.role,
      text: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
    };
    if (event.runId !== undefined) {
      message.runId = event.runId;
      setRunId(event.runId);
    }
    setMessages((current) => upsertMessage(current, message));
  } else if (event.type === 'message/thinking_delta') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({
        ...message,
        thinking: `${message.thinking ?? ''}${event.delta}`,
        status: 'streaming',
      })),
    );
  } else if (event.type === 'message/text_delta') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({
        ...message,
        text: `${message.text}${event.delta}`,
        status: 'streaming',
      })),
    );
  } else if (event.type === 'message/text_snapshot') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({
        ...message,
        text: event.text,
        status: 'streaming',
      })),
    );
  } else if (event.type === 'message/end') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({ ...message, status: 'done' })),
    );
    setRunId(undefined);
  } else if (event.type === 'tool/start') {
    const toolCall: MobileToolCall = {
      id: event.toolCallId,
      name: event.toolName,
      status: 'running',
      summary: event.presentation?.summary,
      actionVerb: event.presentation?.actionVerb,
      command: event.presentation?.command,
      targetPaths: event.presentation?.targetPaths,
      durationMs: event.presentation?.durationMs,
    };
    setMessages((current) => {
      const msgId = event.responseMessageId ?? current.filter((m) => m.role === 'assistant').slice(-1)[0]?.id;
      if (!msgId) return current;
      return updateMessage(current, msgId, (message) => {
        const existing = message.toolCalls ?? [];
        const index = existing.findIndex((t: MobileToolCall) => t.id === event.toolCallId);
        const updated = index === -1 ? [...existing, toolCall] : existing.map((t: MobileToolCall, i: number) => i === index ? { ...t, ...toolCall } : t);
        return { ...message, toolCalls: updated };
      });
    });
  } else if (event.type === 'tool/update') {
    setMessages((current) => {
      const msgId = event.responseMessageId ?? current.filter((m) => m.role === 'assistant').slice(-1)[0]?.id;
      if (!msgId) return current;
      return updateMessage(current, msgId, (message) => {
        const existing = message.toolCalls ?? [];
        const updated = existing.map((t: MobileToolCall) => {
          if (t.id !== event.toolCallId) return t;
          return {
            ...t,
            summary: event.presentation?.summary ?? t.summary,
            actionVerb: event.presentation?.actionVerb ?? t.actionVerb,
            command: event.presentation?.command ?? t.command,
            output: event.presentation?.output?.text ?? `${t.output ?? ''}${event.delta}`,
          };
        });
        return { ...message, toolCalls: updated };
      });
    });
  } else if (event.type === 'tool/end') {
    setMessages((current) => {
      const msgId = event.responseMessageId ?? current.filter((m) => m.role === 'assistant').slice(-1)[0]?.id;
      if (!msgId) return current;
      return updateMessage(current, msgId, (message) => {
        const existing = message.toolCalls ?? [];
        const updated = existing.map((t: MobileToolCall) => {
          if (t.id !== event.toolCallId) return t;
          return {
            ...t,
            status: (event.isError ? 'error' : 'done') as 'done' | 'error',
            summary: event.presentation?.summary ?? t.summary,
            actionVerb: event.presentation?.actionVerb ?? t.actionVerb,
            command: event.presentation?.command ?? t.command,
            targetPaths: event.presentation?.targetPaths ?? t.targetPaths,
            output: event.presentation?.output?.text ?? t.output,
            error: event.presentation?.error?.message ?? (event.isError ? '执行失败' : undefined),
            durationMs: event.presentation?.durationMs ?? t.durationMs,
          };
        });
        return { ...message, toolCalls: updated };
      });
    });
  } else if (event.type === 'session/aborted') {
    setRunId(undefined);
  }
}

function upsertMessage(
  messages: MobileTranscriptMessage[],
  message: MobileTranscriptMessage,
): MobileTranscriptMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return [...messages, message];
  }
  return messages.map((item, itemIndex) => (itemIndex === index ? message : item));
}

function updateMessage(
  messages: MobileTranscriptMessage[],
  messageId: string,
  update: (message: MobileTranscriptMessage) => MobileTranscriptMessage,
): MobileTranscriptMessage[] {
  if (!messages.some((message) => message.id === messageId)) {
    const placeholder: MobileTranscriptMessage = {
      id: messageId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
    };
    return [...messages, placeholder].map((message) =>
      message.id === messageId ? update(message) : message,
    );
  }
  return messages.map((message) => (message.id === messageId ? update(message) : message));
}

function isRemoteProjectSummary(value: unknown): value is RemoteProjectSummary {
  return (
    isRecord(value) && typeof value.projectId === 'string' && typeof value.displayName === 'string'
  );
}

function isRemoteSessionSummary(value: unknown): value is RemoteSessionSummary {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    (value.scope === 'general' || value.scope === 'project' || value.scope === 'unknown')
  );
}

function isRemoteTranscriptMessage(value: unknown): value is RemoteTranscriptMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.role === 'user' ||
      value.role === 'assistant' ||
      value.role === 'system' ||
      value.role === 'tool') &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.status === 'streaming' || value.status === 'done' || value.status === 'error')
  );
}

function disposeClient(
  clientRef: { current: HostClient | undefined },
  unsubscribeRef: { current: Array<() => void> },
): void {
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

function isRecord(value: unknown): value is ResponseRecord {
  return typeof value === 'object' && value !== null;
}

function toError(error: unknown, fallback: string = '未知错误'): Error {
  return error instanceof Error ? error : new Error(fallback);
}
