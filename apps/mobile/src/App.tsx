import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from 'react';
import type {
  HostPush,
  RemoteHostStatusData,
  RemoteMediaAsset,
  RemoteProjectSummary,
  RemoteSessionSummary,
  HostResponse,
  RemoteTranscriptMessage,
} from '@piwin/contracts';
import {
  Button,
  Card,
  EmptyState,
  ListRow,
  Notice,
  PasswordInput,
  PiwinUiProvider,
  RadialBellow,
  StatusBadge,
  TextArea,
  TextInput,
} from '@piwin/ui-kit';
import { HostClient, type HostClientState } from '@piwin/host-client';
import {
  createMobileHostClient,
  getDefaultHostEndpoint,
  isRemoteHostStatusData,
} from './mobile-host-connection.js';
import { MOBILE_THEME } from './mobile-theme.js';

type ResponseRecord = Record<string, unknown>;
type MobileMediaAttachment = {
  id: string;
  kind: 'media';
  path: string;
  mimeType: string;
  byteSize: number;
  source: 'file-picker';
  width?: number;
  height?: number;
};

const MAX_MOBILE_IMAGE_BYTES = 700_000;

export function App(): ReactElement {
  const [endpoint, setEndpoint] = useState(getDefaultHostEndpoint);
  const [authToken, setAuthToken] = useState('');
  const [connectionState, setConnectionState] = useState<HostClientState>({ kind: 'idle' });
  const [hostStatus, setHostStatus] = useState<RemoteHostStatusData | undefined>();
  const [projects, setProjects] = useState<RemoteProjectSummary[]>([]);
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<RemoteTranscriptMessage[]>([]);
  const [composerText, setComposerText] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [pausedCheckpointId, setPausedCheckpointId] = useState<string | undefined>();
  const [permissionRequest, setPermissionRequest] = useState<RemotePermissionRequest | undefined>();
  const [attachments, setAttachments] = useState<MobileMediaAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isResolvingPermission, setIsResolvingPermission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const clientRef = useRef<HostClient | undefined>(undefined);
  const activeSessionRef = useRef<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialConnectInFlightRef = useRef(false);
  const unsubscribeRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    return () => {
      disposeClient(clientRef, unsubscribeRef);
    };
  }, []);

  const refreshRemoteReadModel = async (client: HostClient): Promise<void> => {
    try {
      const [statusResponse, projectsResponse, sessionsResponse] = await Promise.all([
        client.request({ type: 'host/status' }),
        client.request({ type: 'project/list' }),
        client.request({ type: 'session/list' }),
      ]);
      if (clientRef.current !== client) {
        return;
      }
      applyHostStatus(statusResponse, setHostStatus, setErrorMessage);
      setProjects(readProjects(projectsResponse));
      setSessions(readSessions(sessionsResponse));
      const sessionId = activeSessionRef.current;
      if (sessionId !== undefined) {
        const resumeResponse = await client.request({ type: 'session/resume', sessionId });
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

  const handleCreateSession = async (): Promise<void> => {
    const client = clientRef.current;
    if (client === undefined) {
      return;
    }
    try {
      const response = await client.request({
        type: 'session/create',
        input: { scope: { kind: 'general' }, sessionName: 'Mobile session' },
      });
      if (
        !response.success ||
        !isRecord(response.data) ||
        typeof response.data.sessionId !== 'string'
      ) {
        setErrorMessage(response.success ? 'Host 未返回新会话 ID。' : response.error);
        return;
      }
      const nextSessionsResponse = await client.request({ type: 'session/list' });
      const nextSessions = readSessions(nextSessionsResponse);
      setSessions(nextSessions);
      await handleSelectSession(response.data.sessionId);
    } catch (error) {
      setErrorMessage(toError(error, '创建会话失败。').message);
    }
  };

  const handleSend = async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    const text = composerText.trim();
    if (
      client === undefined ||
      sessionId === undefined ||
      text.length === 0 ||
      isSending ||
      pausedCheckpointId !== undefined
    ) {
      return;
    }
    setIsSending(true);
    setErrorMessage(undefined);
    try {
      const response = await client.request({
        type: 'session/prompt',
        sessionId,
        input: {
          text,
          ...(attachments.length === 0 ? {} : { attachments }),
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

  const handlePause = async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    if (client === undefined || sessionId === undefined) return;
    try {
      const response = await client.request({
        type: 'session/pause',
        sessionId,
        ...(activeRunId === undefined ? {} : { runId: activeRunId }),
      });
      if (!response.success) setErrorMessage(response.error);
    } catch (error) {
      setErrorMessage(toError(error, '暂停运行失败。').message);
    }
  };

  const handleResumeRun = async (): Promise<void> => {
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    if (client === undefined || sessionId === undefined || pausedCheckpointId === undefined) {
      return;
    }
    try {
      const response = await client.request({
        type: 'session/resume-run',
        sessionId,
        checkpointId: pausedCheckpointId,
      });
      if (!response.success) {
        setErrorMessage(response.error);
        return;
      }
      setActiveRunId(readRunId(response.data));
      setPausedCheckpointId(undefined);
    } catch (error) {
      setErrorMessage(toError(error, '继续运行失败。').message);
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
      setAttachments((current) => [
        ...current,
        {
          id: asset.id,
          kind: 'media',
          path: `remote-asset:${asset.id}`,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          ...(asset.name === undefined ? {} : { name: asset.name }),
          ...(asset.contentKind === undefined ? {} : { contentKind: asset.contentKind }),
          source: 'file-picker',
          ...(asset.width === undefined ? {} : { width: asset.width }),
          ...(asset.height === undefined ? {} : { height: asset.height }),
        },
      ]);
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

  const connectionView = describeConnectionState(connectionState);
  const isConnected = connectionState.kind === 'ready';
  const activeStreamingAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'streaming');
  const showMobileSendActivity =
    (isSending || activeRunId !== undefined) &&
    (activeStreamingAssistant === undefined || activeStreamingAssistant.text.trim().length === 0);

  return (
    <PiwinUiProvider manifest={MOBILE_THEME}>
      <main className="mobile-shell">
        <header className="mobile-header">
          <div>
            <p className="mobile-eyebrow">PIWIN MOBILE</p>
            <h1>Agent cockpit</h1>
          </div>
          <StatusBadge
            label={connectionView.label}
            tone={connectionView.tone}
            testId="mobile-connection-status"
          />
        </header>

        <section className="mobile-content" aria-label="Host connection">
          <EmptyState
            title={isConnected ? 'Host 已连接' : '连接你的 Piwin Host'}
            description="手机只负责观察和控制，Node、Pi、MCP、Skill 以及项目文件都留在 Host 上。"
            action={
              isConnected ? (
                <Button variant="secondary" onClick={() => void handleDisconnect()}>
                  断开连接
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void handleConnect()}
                  disabled={connectionState.kind === 'connecting'}
                >
                  {connectionState.kind === 'connecting' ? '连接中…' : '连接 Host'}
                </Button>
              )
            }
          >
            <div className="mobile-connection-form">
              <TextInput
                label="Host WebSocket 地址"
                value={endpoint}
                onChange={(event) => setEndpoint(event.currentTarget.value)}
                placeholder="ws://127.0.0.1:8787"
                disabled={isConnected}
                testId="mobile-host-endpoint"
              />
              <PasswordInput
                label="Host Token（可选）"
                value={authToken}
                onChange={(event) => setAuthToken(event.currentTarget.value)}
                placeholder="仅当 Host 开启认证时填写"
                disabled={isConnected}
                testId="mobile-host-token"
              />
              <p className="mobile-empty-detail">
                当前先支持私有网络直连；配对二维码、Keychain 凭据和公网网关会在连接协议稳定后接入。
              </p>
            </div>
          </EmptyState>

          {errorMessage !== undefined ? (
            <Notice tone="error" title="Host 连接异常" testId="mobile-host-error">
              {errorMessage}
            </Notice>
          ) : null}

          {hostStatus !== undefined ? (
            <Card className="mobile-slice-card" withBorder>
              <div className="mobile-card-heading">
                <div>
                  <p className="mobile-eyebrow">HOST STATUS</p>
                  <h2>
                    {hostStatus.mock ? 'Mock Host' : '真实 Host'} · {hostStatus.mode}
                  </h2>
                </div>
                <StatusBadge
                  label={hostStatus.ready ? 'Ready' : 'Starting'}
                  tone={hostStatus.ready ? 'success' : 'warning'}
                />
              </div>
              <dl className="mobile-stat-grid">
                <div>
                  <dt>活跃会话</dt>
                  <dd>{hostStatus.activeSessionCount}</dd>
                </div>
                <div>
                  <dt>项目</dt>
                  <dd>{projects.length}</dd>
                </div>
                <div>
                  <dt>会话列表</dt>
                  <dd>{sessions.length}</dd>
                </div>
                <div>
                  <dt>协议</dt>
                  <dd>v{hostStatus.protocolVersion}</dd>
                </div>
              </dl>
            </Card>
          ) : null}

          {isConnected ? (
            <Card className="mobile-slice-card" withBorder>
              <div className="mobile-card-heading">
                <div>
                  <p className="mobile-eyebrow">REMOTE READ MODEL</p>
                  <h2>已从 Host 读取</h2>
                </div>
                <StatusBadge label="Live" tone="running" />
              </div>
              <div className="mobile-resource-columns">
                <ResourceList title="项目" items={projects.map((project) => project.displayName)} />
                <div className="mobile-resource-list">
                  <div className="mobile-resource-list-heading">
                    <h3>会话</h3>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => void handleCreateSession()}
                    >
                      新建
                    </Button>
                  </div>
                  {sessions.length === 0 ? (
                    <p className="mobile-muted">暂无</p>
                  ) : (
                    <div className="mobile-session-list">
                      {sessions.slice(0, 8).map((session) => (
                        <ListRow
                          key={session.sessionId}
                          compact
                          selected={session.sessionId === activeSessionId}
                          onClick={() => void handleSelectSession(session.sessionId)}
                        >
                          <span>{session.name ?? session.sessionId}</span>
                        </ListRow>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : null}

          {isConnected && activeSessionId !== undefined ? (
            permissionRequest !== undefined ? (
              <Card className="mobile-permission-card" withBorder>
                <div className="mobile-card-heading">
                  <div>
                    <p className="mobile-eyebrow">ACTION REQUIRED</p>
                    <h2>Host 请求权限</h2>
                  </div>
                  <StatusBadge label="需要确认" tone="warning" />
                </div>
                <p className="mobile-permission-action">{permissionRequest.action}</p>
                <p className="mobile-permission-detail">{permissionRequest.detail}</p>
                <div className="mobile-permission-actions">
                  <Button
                    variant="danger"
                    size="compact"
                    onClick={() => void handleResolvePermission('deny')}
                    disabled={isResolvingPermission}
                  >
                    拒绝
                  </Button>
                  <Button
                    variant="primary"
                    size="compact"
                    onClick={() => void handleResolvePermission('allow')}
                    disabled={isResolvingPermission}
                  >
                    {isResolvingPermission ? '处理中…' : '允许一次'}
                  </Button>
                </div>
              </Card>
            ) : null
          ) : null}

          {isConnected && activeSessionId !== undefined ? (
            <Card className="mobile-chat-card" withBorder>
              <div className="mobile-card-heading">
                <div>
                  <p className="mobile-eyebrow">SESSION CHAT</p>
                  <h2>
                    {sessions.find((session) => session.sessionId === activeSessionId)?.name ??
                      activeSessionId}
                  </h2>
                </div>
                {activeRunId !== undefined ? (
                  <>
                    <Button variant="secondary" size="compact" onClick={() => void handlePause()}>
                      暂停
                    </Button>
                    <Button variant="danger" size="compact" onClick={() => void handleAbort()}>
                      停止
                    </Button>
                  </>
                ) : pausedCheckpointId !== undefined ? (
                  <div className="mobile-run-actions">
                    <Button variant="primary" size="compact" onClick={() => void handleResumeRun()}>
                      继续
                    </Button>
                    <Button variant="danger" size="compact" onClick={() => void handleAbort()}>
                      清除暂停点
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="mobile-chat-messages" aria-live="polite">
                {messages.length === 0 ? (
                  <p className="mobile-muted">还没有消息，发送第一条指令。</p>
                ) : (
                  messages.map((message) => (
                    <article
                      className={`mobile-message mobile-message-${message.role}`}
                      key={message.id}
                    >
                      <div className="mobile-message-meta">
                        {message.role} · {message.status}
                      </div>
                      <p>{message.text || '…'}</p>
                    </article>
                  ))
                )}
                {showMobileSendActivity ? (
                  <div
                    className="mobile-send-activity"
                    data-testid="mobile-send-activity"
                    role="status"
                    aria-live="polite"
                  >
                    <RadialBellow
                      size="sm"
                      label="Agent 正在处理"
                      testId="mobile-send-activity-animation"
                    />
                    <span>正在连接模型…</span>
                  </div>
                ) : null}
              </div>
              <div className="mobile-composer">
                <div className="mobile-composer-tools">
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending || isUploadingMedia || attachments.length >= 4}
                  >
                    {isUploadingMedia ? '上传图片…' : '添加图片'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    className="mobile-file-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void handleFileSelected(event)}
                  />
                  {attachments.length > 0 ? (
                    <div className="mobile-attachment-list" aria-label="待发送图片">
                      {attachments.map((attachment) => (
                        <span className="mobile-attachment-chip" key={attachment.id}>
                          {attachment.mimeType.replace('image/', '')} ·{' '}
                          {Math.ceil(attachment.byteSize / 1024)} KB
                          <Button
                            variant="ghost"
                            size="compact"
                            aria-label="移除图片"
                            onClick={() =>
                              setAttachments((current) =>
                                current.filter((item) => item.id !== attachment.id),
                              )
                            }
                          >
                            ×
                          </Button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <TextArea
                  label="发送给 Agent"
                  value={composerText}
                  onChange={(value) => setComposerText(value)}
                  placeholder="告诉 Host 要完成什么…"
                  rows={4}
                  maxLength={512_000}
                  disabled={isSending || isUploadingMedia}
                  testId="mobile-composer"
                />
                <Button
                  variant="primary"
                  onClick={() => void handleSend()}
                  disabled={
                    isSending ||
                    isUploadingMedia ||
                    (composerText.trim().length === 0 && attachments.length === 0)
                  }
                >
                  {isSending ? '发送中…' : '发送'}
                </Button>
              </div>
            </Card>
          ) : null}

          <Card className="mobile-slice-card" withBorder>
            <div className="mobile-card-heading">
              <div>
                <p className="mobile-eyebrow">PHASE 1</p>
                <h2>Host-first 移动壳</h2>
              </div>
              <StatusBadge label="Connected slice" tone="neutral" />
            </div>
            <ul className="mobile-slice-list">
              <li>WebSocket 握手、序号、断线状态和重放基础能力</li>
              <li>HostRuntime 执行安全只读命令，返回脱敏数据</li>
              <li>移动端不导入 Pi，不启动本地 Node sidecar</li>
            </ul>
          </Card>
        </section>
      </main>
    </PiwinUiProvider>
  );
}

function ResourceList({ title, items }: { title: string; items: string[] }): ReactElement {
  return (
    <div className="mobile-resource-list">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="mobile-muted">暂无</p>
      ) : (
        <ul>
          {items.slice(0, 5).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
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

function readSessionMessages(response: HostResponse): RemoteTranscriptMessage[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.messages)) {
    return [];
  }
  return response.data.messages.filter(isRemoteTranscriptMessage);
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
  if (typeof asset.width === 'number' && asset.width >= 0) {
    projected.width = asset.width;
  }
  if (typeof asset.height === 'number' && asset.height >= 0) {
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
  setMessages: Dispatch<SetStateAction<RemoteTranscriptMessage[]>>,
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
    if (push.run.status === 'interrupted' && push.run.terminalCode === 'paused') {
      setPausedCheckpointId(push.run.resumeCheckpointId);
    } else {
      setPausedCheckpointId(undefined);
    }
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
    const message: RemoteTranscriptMessage = {
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
  } else if (event.type === 'session/aborted') {
    setRunId(undefined);
  }
}

function upsertMessage(
  messages: RemoteTranscriptMessage[],
  message: RemoteTranscriptMessage,
): RemoteTranscriptMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return [...messages, message];
  }
  return messages.map((item, itemIndex) => (itemIndex === index ? message : item));
}

function updateMessage(
  messages: RemoteTranscriptMessage[],
  messageId: string,
  update: (message: RemoteTranscriptMessage) => RemoteTranscriptMessage,
): RemoteTranscriptMessage[] {
  if (!messages.some((message) => message.id === messageId)) {
    const placeholder: RemoteTranscriptMessage = {
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

function describeConnectionState(state: HostClientState): {
  label: string;
  tone: 'running' | 'success' | 'warning' | 'danger' | 'neutral';
} {
  switch (state.kind) {
    case 'connecting':
      return { label: '连接中', tone: 'running' };
    case 'ready':
      return { label: 'Host 已连接', tone: 'success' };
    case 'resync-required':
      return { label: '等待同步', tone: 'warning' };
    case 'error':
      return { label: '连接错误', tone: 'danger' };
    case 'disconnected':
      return { label: '未连接 Host', tone: 'warning' };
    case 'idle':
      return { label: '未连接 Host', tone: 'neutral' };
  }
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
    // Closing is asynchronous; the next client is intentionally created after subscriptions are removed.
    void client.close();
  }
}

function isRecord(value: unknown): value is ResponseRecord {
  return typeof value === 'object' && value !== null;
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

type RemotePermissionRequest = Extract<HostPush, { type: 'permission/request' }>;
