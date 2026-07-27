import { useCallback, useEffect, useState } from 'react';
import { useDesktopLocale } from './desktop-locale-context';
import { useConfirmDialog } from './use-confirm-dialog';
import {
  Button,
  Field,
  FieldCheckbox,
  Notice,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@piwin/ui-kit';
import type {
  HostResponse,
  McpConfigDocument,
  McpGetData,
  McpListToolsData,
  McpServerConfig,
  McpServerHealth,
  McpToolSummary,
  McpValidateData,
  McpRegistryCard,
} from '@piwin/contracts';

export type McpPanelProps = {
  request: (command: {
    type:
      | 'mcp/get'
      | 'mcp/validate'
      | 'mcp/save'
      | 'mcp/list_tools'
      | 'mcp/status'
      | 'mcp/start'
      | 'mcp/stop'
      | 'mcp/registry-list'
      | 'mcp/registry-install-draft';
    document?: unknown;
    serverId?: string;
    query?: string;
    draft?: import('@piwin/contracts').McpServerConfig;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

type ServerFormDraft = {
  id: string;
  command: string;
  argsText: string;
  envText: string;
  disabled: boolean;
};

function emptyDraft(): ServerFormDraft {
  return { id: '', command: '', argsText: '', envText: '', disabled: false };
}

function serverToDraft(id: string, server: McpServerConfig): ServerFormDraft {
  return {
    id,
    command: server.command,
    argsText: (server.args ?? []).join(' '),
    envText: Object.entries(server.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    disabled: server.disabled === true,
  };
}

function draftToServer(draft: ServerFormDraft): McpServerConfig {
  const args = draft.argsText
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const env: Record<string, string> = {};
  for (const line of draft.envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  const config: McpServerConfig = { command: draft.command.trim() };
  if (args.length > 0) config.args = args;
  if (Object.keys(env).length > 0) config.env = env;
  if (draft.disabled) config.disabled = true;
  return config;
}

export function McpPanel(props: McpPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const confirmDialog = useConfirmDialog();
  const [mainTab, setMainTab] = useState<'configured' | 'registry'>('configured');
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [registryCards, setRegistryCards] = useState<McpRegistryCard[]>([]);
  const [registryQuery, setRegistryQuery] = useState('');
  const [registryLoading, setRegistryLoading] = useState(false);
  const [rawJson, setRawJson] = useState('{\n  "mcpServers": {}\n}\n');
  const [path, setPath] = useState('~/.piwin/mcp.json');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [document, setDocument] = useState<McpConfigDocument>({ mcpServers: {} });
  const [selectedServerId, setSelectedServerId] = useState('');
  const [draft, setDraft] = useState<ServerFormDraft>(emptyDraft());
  const [tools, setTools] = useState<McpToolSummary[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [healthById, setHealthById] = useState<Record<string, McpServerHealth>>({});
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const applyDocument = useCallback((next: McpConfigDocument, nextPath?: string) => {
    setDocument(next);
    setRawJson(`${JSON.stringify(next, null, 2)}\n`);
    if (nextPath) setPath(nextPath);
    const firstId = Object.keys(next.mcpServers)[0] ?? '';
    setSelectedServerId(firstId);
    if (firstId && next.mcpServers[firstId]) {
      setDraft(serverToDraft(firstId, next.mcpServers[firstId]));
    } else {
      setDraft(emptyDraft());
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    const response = await props.request({ type: 'mcp/status' });
    if (!response.success) {
      return;
    }
    const data = response.data as { servers: McpServerHealth[] };
    const next: Record<string, McpServerHealth> = {};
    for (const server of data.servers ?? []) {
      next[server.serverId] = server;
    }
    setHealthById(next);
  }, [props]);

  const loadConfig = useCallback(async () => {
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'mcp/get' });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as McpGetData;
    applyDocument(data.document, data.path);
    await refreshHealth();
  }, [props, applyDocument, refreshHealth]);

  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true);
    setError(null);
    const response = await props.request({
      type: 'mcp/registry-list',
      ...(registryQuery.trim() ? { query: registryQuery.trim() } : {}),
    });
    setRegistryLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { cards?: McpRegistryCard[] };
    setRegistryCards(data.cards ?? []);
  }, [props, registryQuery]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (mainTab === 'registry') {
      void loadRegistry();
    }
  }, [mainTab, loadRegistry]);

  function selectServer(serverId: string): void {
    setSelectedServerId(serverId);
    const server = document.mcpServers[serverId];
    if (server) {
      setDraft(serverToDraft(serverId, server));
    }
  }

  async function saveDocument(next: McpConfigDocument): Promise<boolean> {
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'mcp/save', document: next });
    if (!response.success) {
      setError(response.error);
      return false;
    }
    const data = response.data as { path: string; document: McpConfigDocument };
    applyDocument(data.document, data.path);
    setInfo(isChinese ? `已保存 ${data.path}` : `Saved ${data.path}`);
    return true;
  }

  async function handleSaveForm(): Promise<void> {
    const id = draft.id.trim();
    if (!id) {
      setError(isChinese ? '请填写服务器 ID。' : 'Server ID is required.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setError(
        isChinese
          ? '服务器 ID 必须匹配 [a-zA-Z0-9_-]+。'
          : 'Server ID must match [a-zA-Z0-9_-]+.',
      );
      return;
    }
    if (!draft.command.trim()) {
      setError(isChinese ? '请填写命令。' : 'Command is required.');
      return;
    }
    const nextServers = { ...document.mcpServers };
    // rename support: remove previous selection if id changed
    if (selectedServerId && selectedServerId !== id) {
      delete nextServers[selectedServerId];
    }
    nextServers[id] = draftToServer(draft);
    await saveDocument({ mcpServers: nextServers });
  }

  async function handleDeleteServer(): Promise<void> {
    if (!selectedServerId) return;
    const ok = await confirmDialog.confirm({
      title: isChinese ? '移除 MCP 服务器？' : 'Remove MCP server?',
      description: isChinese
        ? '这会从 ~/.piwin/mcp.json 中移除该服务器。'
        : 'This removes the server from ~/.piwin/mcp.json.',
      affectedObject: selectedServerId,
      confirmLabel: isChinese ? '移除' : 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const nextServers = { ...document.mcpServers };
    delete nextServers[selectedServerId];
    await saveDocument({ mcpServers: nextServers });
  }

  async function handleValidateRaw(): Promise<boolean> {
    setError(null);
    setInfo(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : isChinese ? '无效的 JSON' : 'Invalid JSON');
      return false;
    }
    const response = await props.request({ type: 'mcp/validate', document: parsed });
    if (!response.success) {
      setError(response.error);
      return false;
    }
    const data = response.data as McpValidateData;
    if (!data.valid) {
      setError(data.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
      return false;
    }
    applyDocument(data.document);
    setInfo(isChinese ? 'mcp.json 有效。' : 'Valid mcp.json.');
    return true;
  }

  async function handleSaveRaw(): Promise<void> {
    if (!(await handleValidateRaw())) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return;
    }
    await saveDocument(parsed as McpConfigDocument);
  }

  async function handleStartServer(): Promise<void> {
    if (!selectedServerId) {
      setError(isChinese ? '请先选择一个服务器。' : 'Select a server first.');
      return;
    }
    setLifecycleBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'mcp/start', serverId: selectedServerId });
    setLifecycleBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { health: McpServerHealth };
    setHealthById((current) => ({ ...current, [data.health.serverId]: data.health }));
    setInfo(
      data.health.status === 'running'
        ? isChinese
          ? `已启动 ${data.health.serverId}（${data.health.toolCount} 个工具，已写入会话缓存）`
          : `Started ${data.health.serverId} (${data.health.toolCount} tools; metadata cached for new sessions)`
        : isChinese
          ? `启动 ${data.health.serverId}：${data.health.status}${data.health.lastError ? ` — ${data.health.lastError}` : ''}`
          : `Start ${data.health.serverId}: ${data.health.status}${data.health.lastError ? ` — ${data.health.lastError}` : ''}`,
    );
  }

  async function handleStopServer(): Promise<void> {
    if (!selectedServerId) {
      setError(isChinese ? '请先选择一个服务器。' : 'Select a server first.');
      return;
    }
    setLifecycleBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'mcp/stop', serverId: selectedServerId });
    setLifecycleBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { health: McpServerHealth };
    setHealthById((current) => ({ ...current, [data.health.serverId]: data.health }));
    setInfo(isChinese ? `已停止 ${data.health.serverId}` : `Stopped ${data.health.serverId}`);
  }

  async function handlePreviewTools(): Promise<void> {
    if (!selectedServerId) {
      setError(isChinese ? '请先选择一个服务器。' : 'Select a server first.');
      return;
    }
    setLoadingTools(true);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'mcp/list_tools',
      serverId: selectedServerId,
    });
    setLoadingTools(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as McpListToolsData;
    setTools(data.tools ?? []);
    setInfo(
      data.tools.length === 0
        ? isChinese
          ? `${selectedServerId} 未提供工具`
          : `No tools from ${selectedServerId}`
        : isChinese
          ? `已从 ${selectedServerId} 加载 ${data.tools.length} 个工具（已缓存，新建会话可直接使用）`
          : `Loaded ${data.tools.length} tool(s) from ${selectedServerId} (cached for new sessions)`,
    );
  }

  async function handleInstallDraft(card: McpRegistryCard): Promise<void> {
    setError(null);
    setInfo(null);
    const draft = card.installDraft ?? (card.manualDraft as McpServerConfig | undefined);
    if (!draft || !draft.command) {
      setError(
        isChinese ? '此卡片没有安装草稿，请手动配置。' : 'This card has no install draft — configure manually.',
      );
      return;
    }
    if (card.requiresSse) {
      setInfo(
        isChinese
          ? '尚未完全支持 SSE 传输；草稿已作为 stdio 配置保存以供审核。'
          : 'SSE transport is not fully supported; draft saved as stdio config for review.',
      );
    }
    const response = await props.request({
      type: 'mcp/registry-install-draft',
      serverId: card.id.replace(/[^a-zA-Z0-9._-]/g, '-'),
      draft,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? `已安装 ${card.title} 的草稿` : `Installed draft for ${card.title}`);
    setMainTab('configured');
    await loadConfig();
  }

  const serverIds = Object.keys(document.mcpServers);

  return (
    <>
    {confirmDialog.dialog}
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>MCP</h3>
        <p className="muted">
          {isChinese ? '兼容 Cursor 的 ' : 'Cursor-compatible '}
          <code>mcpServers</code>。{isChinese ? '路径：' : 'Path: '}<code>{path}</code>。
          {isChinese
            ? '密钥保留为环境变量值/引用，UI 不会解析它们。注册表是静态离线目录。'
            : 'Secrets stay as env values/refs — UI does not resolve them. Registry is a static/offline catalog.'}
        </p>

        <Tabs
          value={mainTab}
          onValueChange={(value) => setMainTab(value as 'configured' | 'registry')}
          testId="mcp-main-tabs"
        >
          <TabsList className="mcp-tabs" label={isChinese ? 'MCP 视图' : 'MCP views'}>
            <TabsTrigger value="configured" className="mcp-tab" testId="mcp-tab-configured">
              {isChinese ? '已配置' : 'Configured'}
            </TabsTrigger>
            <TabsTrigger value="registry" className="mcp-tab" testId="mcp-tab-registry">
              {isChinese ? '注册表' : 'Registry'}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="configured" className="mcp-tab-content">
            {error ? <Notice tone="error" title={isChinese ? 'MCP 操作失败' : 'MCP action failed'}>{error}</Notice> : null}
            {info ? <Notice tone="info">{info}</Notice> : null}

            <div className="mcp-workbench">
              <aside className="mcp-server-list">
                <div className="mcp-pane-heading">
                  <div>
                    <span>{isChinese ? '服务器' : 'Servers'}</span>
                    <small>{serverIds.length}</small>
                  </div>
                  <Button
                    size="compact"
                    onClick={() => {
                      setSelectedServerId('');
                      setDraft(emptyDraft());
                      setTab('form');
                      setTools([]);
                    }}
                  >
                    {isChinese ? '新建' : 'New'}
                  </Button>
                </div>
                <ul className="mcp-server-list-items">
                  {serverIds.length === 0 ? (
                    <li className="mcp-server-list-empty muted">
                      {isChinese ? '尚未配置服务器' : 'No servers configured'}
                    </li>
                  ) : (
                    serverIds.map((serverId) => {
                      const server = document.mcpServers[serverId];
                      const health = healthById[serverId];
                      const status = server?.disabled
                        ? isChinese
                          ? '已禁用'
                          : 'disabled'
                        : health?.status ?? (isChinese ? '未启动' : 'stopped');
                      return (
                        <li key={serverId}>
                          <button
                            type="button"
                            className={
                              selectedServerId === serverId
                                ? 'mcp-server-list-item active'
                                : 'mcp-server-list-item'
                            }
                            onClick={() => {
                              selectServer(serverId);
                              setTools([]);
                            }}
                          >
                            <span className="mcp-server-list-title">
                              <strong>{serverId}</strong>
                              <span className={server?.disabled ? 'mcp-status disabled' : 'mcp-status'}>
                                {status}
                              </span>
                            </span>
                            <span className="mcp-server-list-meta">
                              {health?.toolCount
                                ? isChinese
                                  ? `${health.toolCount} 个工具`
                                  : `${health.toolCount} tools`
                                : server?.command ?? ''}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </aside>

              <section className="mcp-editor-pane">
                <header className="mcp-editor-header">
                  <div>
                    <h4>
                      {tab === 'raw'
                        ? isChinese ? '原始 JSON' : 'Raw JSON'
                        : selectedServerId
                          ? isChinese ? `编辑 ${selectedServerId}` : `Edit ${selectedServerId}`
                          : isChinese ? '添加服务器' : 'Add server'}
                    </h4>
                    <p className="muted">
                      {tab === 'raw'
                        ? isChinese ? '保存前会验证完整的 mcp.json 文档。' : 'The complete mcp.json document is validated before it is saved.'
                        : isChinese ? '密钥只保留为环境变量或引用，不会被 UI 解析。' : 'Secrets remain environment variables or references; the UI never resolves them.'}
                    </p>
                  </div>
                  <Tabs value={tab} onValueChange={(value) => setTab(value as 'form' | 'raw')}>
                    <TabsList className="segmented-control" label={isChinese ? 'MCP 编辑器模式' : 'MCP editor mode'}>
                      <TabsTrigger className="segmented-control-item" value="form">
                        {isChinese ? '表单' : 'Form'}
                      </TabsTrigger>
                      <TabsTrigger className="segmented-control-item" value="raw">
                        Raw JSON
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </header>

                {tab === 'form' ? (
                  <div className="mcp-editor-body">
                    <div className="mcp-form-grid">
                      <Field label={isChinese ? '服务器 ID' : 'Server ID'} required>
                        <input
                          value={draft.id}
                          onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                          placeholder="memory"
                        />
                      </Field>
                      <Field label={isChinese ? '命令' : 'Command'} required>
                        <input
                          value={draft.command}
                          onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                          placeholder="npx"
                        />
                      </Field>
                    </div>
                    <Field label={isChinese ? '参数（以空格分隔）' : 'Args (space-separated)'}>
                      <input
                        value={draft.argsText}
                        onChange={(event) => setDraft({ ...draft, argsText: event.target.value })}
                        placeholder="-y @modelcontextprotocol/server-memory"
                      />
                    </Field>
                    <Field label={isChinese ? `环境变量（每行 KEY=VALUE，支持 ${'{ENV}'}）` : `Env (KEY=VALUE per line, supports ${'{ENV}'})`}>
                      <textarea
                        className="mcp-raw-editor"
                        rows={5}
                        value={draft.envText}
                        onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                        placeholder="API_KEY=${API_KEY}"
                      />
                    </Field>
                    <FieldCheckbox
                      label={isChinese ? '禁用' : 'Disabled'}
                      description={isChinese ? '选中后，不会随新会话启动此服务器。' : 'When checked, this server is not started with new sessions.'}
                      checked={draft.disabled}
                      testId="mcp-server-disabled"
                      onCheckedChange={(checked) => setDraft({ ...draft, disabled: checked })}
                    />
                  </div>
                ) : (
                  <div className="mcp-editor-body">
                    <Field label={isChinese ? 'mcp.json 文档' : 'mcp.json document'}>
                      <textarea
                        className="mcp-raw-editor mcp-raw-document"
                        rows={16}
                        value={rawJson}
                        onChange={(event) => setRawJson(event.target.value)}
                        spellCheck={false}
                        data-testid="mcp-raw-json"
                      />
                    </Field>
                  </div>
                )}

                {tools.length > 0 && tab === 'form' ? (
                  <section className="mcp-tools-preview">
                    <h5>{isChinese ? '工具预览' : 'Tools preview'}</h5>
                    <ul className="mcp-tools-list">
                      {tools.map((tool) => (
                        <li key={tool.exposedName}>
                          <strong>{tool.exposedName}</strong>
                          <span className="muted">{tool.description || tool.name}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <footer className="mcp-editor-actions">
                  {tab === 'form' ? (
                    <>
                      <Button variant="primary" onClick={() => void handleSaveForm()}>
                        {isChinese ? '保存服务器' : 'Save server'}
                      </Button>
                      <Button
                        disabled={!selectedServerId}
                        onClick={() => void handleDeleteServer()}
                      >
                        {isChinese ? '删除' : 'Delete'}
                      </Button>
                      <span className="mcp-action-spacer" />
                      <Button
                        disabled={!selectedServerId || lifecycleBusy}
                        onClick={() => void handleStartServer()}
                      >
                        {isChinese ? '启动' : 'Start'}
                      </Button>
                      <Button
                        disabled={!selectedServerId || lifecycleBusy}
                        onClick={() => void handleStopServer()}
                      >
                        {isChinese ? '停止' : 'Stop'}
                      </Button>
                      <Button
                        disabled={!selectedServerId || loadingTools}
                        onClick={() => void handlePreviewTools()}
                      >
                        {loadingTools ? (isChinese ? '正在探测…' : 'Probing…') : isChinese ? '列出工具' : 'List tools'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => void handleValidateRaw()}>
                        {isChinese ? '验证' : 'Validate'}
                      </Button>
                      <Button variant="primary" onClick={() => void handleSaveRaw()}>
                        {isChinese ? '保存 JSON' : 'Save JSON'}
                      </Button>
                    </>
                  )}
                  <Button
                    disabled={lifecycleBusy}
                    onClick={() => void refreshHealth()}
                  >
                    {isChinese ? '刷新状态' : 'Refresh status'}
                  </Button>
                </footer>
              </section>
            </div>

            <div className="manager-actions">
              <Button onClick={() => void loadConfig()}>
                {isChinese ? '重新加载' : 'Reload'}
              </Button>
              {props.variant !== 'inline' ? (
                <Button onClick={props.onClose}>
                  {isChinese ? '关闭' : 'Close'}
                </Button>
              ) : null}
            </div>

          </TabsContent>
          <TabsContent value="registry" className="mcp-tab-content" testId="mcp-registry-panel">
            <div className="drawer-actions" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label={isChinese ? '筛选注册表' : 'Filter registry'}>
                  <input
                    data-testid="mcp-registry-search"
                    value={registryQuery}
                    onChange={(event) => setRegistryQuery(event.target.value)}
                    placeholder={isChinese ? '标题、ID 或描述…' : 'Title, ID, or description…'}
                  />
                </Field>
              </div>
              <Button
                data-testid="mcp-registry-refresh"
                disabled={registryLoading}
                onClick={() => void loadRegistry()}
              >
                {registryLoading ? (isChinese ? '正在加载…' : 'Loading…') : isChinese ? '刷新' : 'Refresh'}
              </Button>
            </div>
            <ul className="ext-list" data-testid="mcp-registry-list">
              {registryCards.length === 0 && !registryLoading ? (
                <li className="muted">{isChinese ? '没有注册表卡片' : 'No registry cards'}</li>
              ) : (
                registryCards.map((card) => (
                  <li key={card.id} className="ext-list-item" data-testid="mcp-registry-item">
                    <div className="ext-list-main">
                      <div className="ext-list-title">
                        <strong>{card.title}</strong>
                        <span className="pill">{card.source}</span>
                        {card.requiresSse ? <span className="pill">sse</span> : null}
                      </div>
                      <div className="muted ext-desc">{card.description}</div>
                      {card.installDraft ? (
                        <div className="muted ext-path">
                          {card.installDraft.command} {(card.installDraft.args ?? []).join(' ')}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      variant="primary"
                      data-testid="mcp-registry-install-btn"
                      onClick={() => void handleInstallDraft(card)}
                    >
                      {isChinese ? '安装草稿' : 'Install draft'}
                    </Button>
                  </li>
                ))
              )}
            </ul>
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </>
  );
}
