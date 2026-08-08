import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktopLocale } from './desktop-locale-context';
import { useConfirmDialog } from './use-confirm-dialog';
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Notice,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextInput,
  showUiNotification,
} from '@piwin/ui-kit';
import type {
  HostResponse,
  McpConfigDocument,
  McpGetData,
  McpListToolsData,
  McpServerConfig,
  McpServerHealth,
  McpToolSummary,
  McpRegistryCard,
  McpValidateData,
} from '@piwin/contracts';
import { PageTitle } from './settings/page-title';
import { McpServerEditorDialog } from './McpServerEditorDialog';
import { IconPin } from './shell-icons';

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

export function McpPanel(props: McpPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const confirmDialog = useConfirmDialog();
  const [mainTab, setMainTab] = useState<'configured' | 'registry'>('configured');
  const [registryCards, setRegistryCards] = useState<McpRegistryCard[]>([]);
  const [registryQuery, setRegistryQuery] = useState('');
  const [registryLoading, setRegistryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<McpConfigDocument>({
    mcpServers: {},
    pinnedSelectors: [],
  });
  const documentRef = useRef(document);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const [healthById, setHealthById] = useState<Record<string, McpServerHealth>>({});
  const [loading, setLoading] = useState(true);

  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorAutoProbe, setEditorAutoProbe] = useState(false);
  const [editServerId, setEditServerId] = useState('');
  const [editServer, setEditServer] = useState<McpServerConfig | undefined>(undefined);
  const [prefillDraft, setPrefillDraft] = useState<McpServerConfig | null>(null);
  const [prefillId, setPrefillId] = useState('');

  function updateDocument(next: McpConfigDocument): void {
    documentRef.current = next;
    setDocument(next);
  }

  const refreshHealth = useCallback(async () => {
    const response = await props.request({ type: 'mcp/status' });
    if (!response.success) return;
    const data = response.data as { servers: McpServerHealth[] };
    const next: Record<string, McpServerHealth> = {};
    for (const server of data.servers ?? []) {
      next[server.serverId] = server;
    }
    setHealthById(next);
  }, [props]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await props.request({ type: 'mcp/get' });
    if (!response.success) {
      setError(response.error);
      setLoading(false);
      return;
    }
    const data = response.data as McpGetData;
    updateDocument(data.document);
    await refreshHealth();
    setLoading(false);
  }, [props, refreshHealth]);

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

  async function saveDocumentNow(payload: McpConfigDocument): Promise<boolean> {
    setError(null);
    const response = await props.request({ type: 'mcp/save', document: payload });
    if (!response.success) {
      setError(response.error);
      showUiNotification({
        tone: 'error',
        title: isChinese ? 'MCP 保存失败' : 'MCP Save Failed',
        message: response.error,
        autoClose: 5000,
      });
      return false;
    }
    const data = response.data as { path: string; document: McpConfigDocument };
    updateDocument(data.document);
    showUiNotification({
      tone: 'success',
      message: isChinese ? `已保存 ${data.path}` : `Saved ${data.path}`,
      autoClose: 3500,
    });
    return true;
  }

  function saveDocument(next: McpConfigDocument): Promise<boolean> {
    const payload: McpConfigDocument =
      next.pinnedSelectors === undefined
        ? { ...next, pinnedSelectors: documentRef.current.pinnedSelectors ?? [] }
        : next;
    const operation = saveQueueRef.current.then(
      () => saveDocumentNow(payload),
      () => saveDocumentNow(payload),
    );
    saveQueueRef.current = operation.catch(() => false);
    return operation;
  }

  async function handleTogglePinned(selector: string, pinned: boolean): Promise<boolean> {
    const currentDocument = documentRef.current;
    const current = new Set(currentDocument.pinnedSelectors ?? []);
    if (pinned) {
      current.add(selector);
    } else {
      current.delete(selector);
    }
    const nextDocument: McpConfigDocument = {
      mcpServers: currentDocument.mcpServers,
      pinnedSelectors: [...current],
    };
    // Update the ref synchronously so two rapid clicks compose against the
    // latest intent instead of the last React render.
    updateDocument(nextDocument);
    return saveDocument(nextDocument);
  }

  function openAddEditor(): void {
    setEditServerId('');
    setEditServer(undefined);
    setPrefillDraft(null);
    setPrefillId('');
    setEditorAutoProbe(false);
    setEditorOpen(true);
  }

  function openEditEditor(serverId: string): void {
    setEditServerId(serverId);
    setEditServer(document.mcpServers[serverId]);
    setPrefillDraft(null);
    setPrefillId('');
    setEditorAutoProbe(false);
    setEditorOpen(true);
  }

  function openPinEditor(serverId: string): void {
    setEditServerId(serverId);
    setEditServer(document.mcpServers[serverId]);
    setPrefillDraft(null);
    setPrefillId('');
    setEditorAutoProbe(true);
    setEditorOpen(true);
  }

  async function handleSaveFromEditor(
    id: string,
    config: McpServerConfig,
    originalId: string,
  ): Promise<boolean> {
    const nextServers = { ...document.mcpServers };
    if (originalId && originalId !== id) {
      delete nextServers[originalId];
    }
    nextServers[id] = config;
    let nextPins = documentRef.current.pinnedSelectors ?? [];
    if (originalId && originalId !== id) {
      const oldPrefix = `${originalId}.`;
      const newPrefix = `${id}.`;
      nextPins = nextPins.map((selector) =>
        selector.startsWith(oldPrefix)
          ? `${newPrefix}${selector.slice(oldPrefix.length)}`
          : selector,
      );
    }
    const ok = await saveDocument({
      mcpServers: nextServers,
      pinnedSelectors: nextPins,
    });
    if (ok) {
      await refreshHealth();
    }
    return ok;
  }

  async function handleValidateRawFromEditor(raw: unknown): Promise<{
    valid: boolean;
    document?: McpConfigDocument;
    issues?: Array<{ path: string; message: string }>;
  }> {
    const response = await props.request({ type: 'mcp/validate', document: raw });
    if (!response.success) {
      return { valid: false, issues: [{ path: '', message: response.error }] };
    }
    const data = response.data as McpValidateData;
    if (data.valid) {
      return { valid: true, document: data.document };
    }
    return { valid: false, issues: data.issues };
  }

  async function handleSaveRawFromEditor(next: McpConfigDocument): Promise<boolean> {
    return saveDocument(next);
  }

  const handlePreviewToolsFromEditor = useCallback(
    async (serverId: string, config: McpServerConfig): Promise<McpToolSummary[]> => {
      const currentDocument = documentRef.current;
      const exists = Boolean(currentDocument.mcpServers[serverId]);
      if (!exists) {
        const nextServers = { ...currentDocument.mcpServers, [serverId]: config };
        const ok = await saveDocument({ mcpServers: nextServers });
        if (!ok) return [];
      }
      const response = await props.request({ type: 'mcp/list_tools', serverId });
      if (!response.success) {
        setError(response.error);
        return [];
      }
      const data = response.data as McpListToolsData;
      return data.tools ?? [];
    },
    // saveDocument closes over documentRef/saveQueueRef; request is the only external input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.request],
  );

  async function handleToggleServer(serverId: string, enable: boolean): Promise<void> {
    const server = document.mcpServers[serverId];
    if (!server) return;
    setError(null);
    if (enable) {
      const nextServers = { ...document.mcpServers, [serverId]: { ...server, disabled: false } };
      if (!(await saveDocument({ mcpServers: nextServers }))) return;
      const response = await props.request({ type: 'mcp/start', serverId });
      if (!response.success) {
        showUiNotification({
          tone: 'error',
          title: isChinese ? '启动 MCP 服务器失败' : 'Failed to start MCP server',
          message: response.error,
          autoClose: 5000,
        });
        return;
      }
      const data = response.data as { health: McpServerHealth };
      setHealthById((current) => ({ ...current, [data.health.serverId]: data.health }));
      showUiNotification({
        tone: 'success',
        message: isChinese ? `已启动 ${serverId}` : `Started ${serverId}`,
        autoClose: 3000,
      });
    } else {
      const stopResponse = await props.request({ type: 'mcp/stop', serverId });
      if (stopResponse.success) {
        const data = stopResponse.data as { health: McpServerHealth };
        setHealthById((current) => ({ ...current, [data.health.serverId]: data.health }));
      }
      const nextServers = { ...document.mcpServers, [serverId]: { ...server, disabled: true } };
      const saved = await saveDocument({ mcpServers: nextServers });
      if (saved) {
        showUiNotification({
          tone: 'success',
          message: isChinese ? `已禁用 ${serverId}` : `Disabled ${serverId}`,
          autoClose: 3000,
        });
      }
    }
  }

  async function handleDeleteServer(serverId: string): Promise<void> {
    const ok = await confirmDialog.confirm({
      title: isChinese ? '移除 MCP 服务器？' : 'Remove MCP server?',
      description: isChinese
        ? '这会从 ~/.piwin/mcp.json 中移除该服务器。'
        : 'This removes the server from ~/.piwin/mcp.json.',
      affectedObject: serverId,
      confirmLabel: isChinese ? '移除' : 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const nextServers = { ...document.mcpServers };
    delete nextServers[serverId];
    const pinPrefix = `${serverId}.`;
    const nextPins = (documentRef.current.pinnedSelectors ?? []).filter(
      (selector) => !selector.startsWith(pinPrefix),
    );
    const saved = await saveDocument({
      mcpServers: nextServers,
      pinnedSelectors: nextPins,
    });
    if (saved) {
      showUiNotification({
        tone: 'success',
        message: isChinese ? `已移除 ${serverId}` : `Removed ${serverId}`,
        autoClose: 3000,
      });
    }
  }

  async function handleInstallDraft(card: McpRegistryCard): Promise<void> {
    setError(null);
    const draft = card.installDraft ?? (card.manualDraft as McpServerConfig | undefined);
    if (!draft || !draft.command) {
      showUiNotification({
        tone: 'error',
        message: isChinese
          ? '此卡片没有安装草稿，请手动配置。'
          : 'This card has no install draft — configure manually.',
        autoClose: 4000,
      });
      return;
    }
    const response = await props.request({
      type: 'mcp/registry-install-draft',
      serverId: card.id.replace(/[^a-zA-Z0-9._-]/g, '-'),
      draft,
    });
    if (!response.success) {
      showUiNotification({
        tone: 'error',
        title: isChinese ? '安装草稿失败' : 'Failed to install draft',
        message: response.error,
        autoClose: 5000,
      });
      return;
    }
    showUiNotification({
      tone: 'success',
      message: isChinese ? `已安装 ${card.title} 的草稿` : `Installed draft for ${card.title}`,
      autoClose: 3500,
    });
    setMainTab('configured');
    await loadConfig();
  }

  const serverIds = Object.keys(document.mcpServers);

  return (
    <>
      {confirmDialog.dialog}
      <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
        <div
          className={
            props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'
          }
        >
          <Tabs
            value={mainTab}
            onValueChange={(value) => setMainTab(value as 'configured' | 'registry')}
            testId="mcp-main-tabs"
          >
            {props.variant !== 'inline' ? (
              <PageTitle
                title={isChinese ? 'MCP 服务器' : 'MCP Servers'}
                description={
                  mainTab === 'configured'
                    ? isChinese
                      ? '管理本地 MCP 服务器。打开服务器可固定直调工具；未固定工具由 Agent 通过 mcp_gateway 调用。'
                      : 'Manage local MCP servers. Open a server to pin direct tools; unpinned tools are called via mcp_gateway.'
                    : isChinese
                      ? '从开放市场浏览并安装社区 MCP 服务器。'
                      : 'Browse and install MCP servers from the community marketplace.'
                }
              />
            ) : null}

            <div
              className="mcp-tabs-toolbar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
                gap: 12,
              }}
            >
              <TabsList className="segmented-control" label={isChinese ? 'MCP 视图' : 'MCP views'}>
                <TabsTrigger
                  value="configured"
                  className="segmented-control-item"
                  testId="mcp-tab-configured"
                >
                  {isChinese ? `已配置 (${serverIds.length})` : `Configured (${serverIds.length})`}
                </TabsTrigger>
                <TabsTrigger
                  value="registry"
                  className="segmented-control-item"
                  testId="mcp-tab-registry"
                >
                  {isChinese ? '市场' : 'Marketplace'}
                </TabsTrigger>
              </TabsList>
              {mainTab === 'configured' && (
                <Button
                  size="compact"
                  variant="primary"
                  onClick={openAddEditor}
                  data-testid="mcp-add-btn"
                >
                  + {isChinese ? '添加服务器' : 'Add Server'}
                </Button>
              )}
            </div>

            <TabsContent value="configured" className="mcp-tab-content">
              {error && serverIds.length === 0 ? (
                <div className="ui-feedback-host" aria-live="polite" style={{ marginBottom: 16 }}>
                  <Notice tone="error" title={isChinese ? 'MCP 加载失败' : 'MCP load failed'}>
                    {error}
                  </Notice>
                </div>
              ) : null}

              {loading ? (
                <div className="mcp-loading-state">
                  <Spinner />
                </div>
              ) : serverIds.length === 0 ? (
                <div className="mcp-empty-list">
                  <p style={{ marginBottom: 16 }}>
                    {isChinese
                      ? '尚未配置服务器。点击「添加服务器」创建第一个 MCP 服务器。'
                      : 'No servers configured. Click "Add Server" to create your first MCP server.'}
                  </p>
                  <Button size="compact" variant="primary" onClick={openAddEditor}>
                    + {isChinese ? '添加服务器' : 'Add Server'}
                  </Button>
                </div>
              ) : (
                <ul className="ext-list mcp-server-list-clean" data-testid="mcp-server-list">
                  {serverIds.map((serverId) => {
                    const server = document.mcpServers[serverId];
                    const health = healthById[serverId];
                    const isEnabled = !server?.disabled;
                    const runtimeStatus = !isEnabled
                      ? 'stopped'
                      : health?.status === 'error'
                        ? 'error'
                        : health?.status === 'starting'
                          ? 'starting'
                          : 'running';
                    const toolCount = health?.toolCount ?? 0;
                    const fullCommand = [server?.command ?? '', ...(server?.args ?? [])]
                      .filter(Boolean)
                      .join(' ');
                    const envCount = Object.keys(server?.env ?? {}).length;
                    const pinPrefix = `${serverId}.`;
                    const pinnedCount = (document.pinnedSelectors ?? []).filter((selector) =>
                      selector.startsWith(pinPrefix),
                    ).length;

                    return (
                      <li
                        key={serverId}
                        className="ext-list-item mcp-server-card"
                        data-testid={`mcp-server-${serverId}`}
                      >
                        <div
                          className="mcp-server-card-body"
                          onClick={() => openEditEditor(serverId)}
                        >
                          <div className="mcp-server-card-title">
                            <span
                              className={`mcp-status-dot-inline ${runtimeStatus}`}
                              title={
                                runtimeStatus === 'running'
                                  ? isChinese
                                    ? '运行中'
                                    : 'Running'
                                  : runtimeStatus === 'starting'
                                    ? isChinese
                                      ? '启动中'
                                      : 'Starting'
                                    : runtimeStatus === 'error'
                                      ? isChinese
                                        ? '运行错误'
                                        : 'Error'
                                      : isChinese
                                        ? '已停止'
                                        : 'Stopped'
                              }
                            />
                            <strong className="mcp-server-id">{serverId}</strong>
                            {!isEnabled ? (
                              <span className="mcp-disabled-pill">
                                {isChinese ? '已禁用' : 'disabled'}
                              </span>
                            ) : null}
                          </div>
                          <div className="mcp-server-card-meta">
                            <code className="mcp-command-snippet" title={fullCommand}>
                              {fullCommand || (isChinese ? '(无命令)' : '(no command)')}
                            </code>
                            {toolCount > 0 && (
                              <span className="mcp-meta-badge mcp-tools-badge">
                                {isChinese ? `${toolCount} 个工具` : `${toolCount} tools`}
                              </span>
                            )}
                            {pinnedCount > 0 && (
                              <span
                                className="mcp-meta-badge mcp-pinned-badge"
                                title={
                                  isChinese
                                    ? `${pinnedCount} 个工具已固定为直接调用`
                                    : `${pinnedCount} tool(s) pinned for direct call`
                                }
                                data-testid={`mcp-server-pinned-count-${serverId}`}
                              >
                                {isChinese ? `${pinnedCount} 直调` : `${pinnedCount} pinned`}
                              </span>
                            )}
                            {envCount > 0 && (
                              <span className="mcp-meta-badge mcp-env-badge">
                                {isChinese ? `${envCount} 个环境变量` : `${envCount} env vars`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mcp-server-card-actions">
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => {
                              void handleToggleServer(serverId, checked);
                            }}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={isChinese ? `切换 ${serverId}` : `Toggle ${serverId}`}
                          />
                          <IconButton
                            label={
                              isChinese
                                ? `管理 ${serverId} 的固定工具`
                                : `Manage pinned tools for ${serverId}`
                            }
                            title={
                              pinnedCount > 0
                                ? isChinese
                                  ? `${pinnedCount} 个工具已固定`
                                  : `${pinnedCount} tool(s) pinned`
                                : isChinese
                                  ? '打开并探测工具以固定'
                                  : 'Open and probe tools to pin'
                            }
                            className={
                              pinnedCount > 0
                                ? 'mcp-server-pin-btn mcp-server-pin-btn--active'
                                : 'mcp-server-pin-btn'
                            }
                            data-testid={`mcp-server-pin-trigger-${serverId}`}
                            onClick={() => openPinEditor(serverId)}
                          >
                            <IconPin
                              className={
                                pinnedCount > 0
                                  ? 'mcp-server-pin-icon mcp-server-pin-icon--filled'
                                  : 'mcp-server-pin-icon'
                              }
                              width={16}
                              height={16}
                            />
                          </IconButton>
                          <DropdownMenu
                            align="end"
                            side="bottom"
                            label={isChinese ? '服务器操作' : 'Server actions'}
                            trigger={
                              <button
                                type="button"
                                className="mcp-row-menu-trigger"
                                aria-label={isChinese ? '更多操作' : 'More actions'}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                  <circle cx="8" cy="4" r="1.5" />
                                  <circle cx="8" cy="8" r="1.5" />
                                  <circle cx="8" cy="12" r="1.5" />
                                </svg>
                              </button>
                            }
                          >
                            <DropdownMenuItem onSelect={() => openEditEditor(serverId)}>
                              {isChinese ? '编辑' : 'Edit'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void refreshHealth()}>
                              {isChinese ? '重新加载' : 'Reload'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              danger
                              onSelect={() => void handleDeleteServer(serverId)}
                            >
                              {isChinese ? '删除' : 'Delete'}
                            </DropdownMenuItem>
                          </DropdownMenu>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="registry" className="mcp-tab-content" testId="mcp-registry-panel">
              <div className="settings-toolbar mcp-marketplace-search">
                <TextInput
                  toolbar
                  data-testid="mcp-registry-search"
                  value={registryQuery}
                  onChange={(event) => setRegistryQuery(event.currentTarget.value)}
                  placeholder={
                    isChinese ? '筛选标题、ID 或描述…' : 'Filter by title, id, or description…'
                  }
                  aria-label={isChinese ? '筛选' : 'Filter'}
                />
                <Button
                  size="compact"
                  data-testid="mcp-registry-refresh"
                  disabled={registryLoading}
                  onClick={() => void loadRegistry()}
                >
                  {registryLoading
                    ? isChinese
                      ? '加载中...'
                      : 'Loading...'
                    : isChinese
                      ? '刷新'
                      : 'Refresh'}
                </Button>
              </div>
              {registryLoading && (
                <div className="mcp-loading-state">
                  <Spinner />
                </div>
              )}
              <ul className="ext-list" data-testid="mcp-registry-list">
                {registryCards.length === 0 && !registryLoading ? (
                  <li className="mcp-empty-inline muted">
                    {isChinese ? '未找到相关服务器' : 'No servers found'}
                  </li>
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
                      </div>
                      <Button
                        variant="primary"
                        size="compact"
                        data-testid="mcp-registry-install-btn"
                        onClick={() => void handleInstallDraft(card)}
                      >
                        {isChinese ? '安装' : 'Install'}
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <McpServerEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        serverId={editServerId}
        server={editServer}
        document={document}
        prefillDraft={prefillDraft}
        prefillId={prefillId}
        autoProbe={editorAutoProbe}
        isChinese={isChinese}
        onSave={handleSaveFromEditor}
        onValidateRaw={handleValidateRawFromEditor}
        onSaveRaw={handleSaveRawFromEditor}
        onPreviewTools={handlePreviewToolsFromEditor}
        onTogglePinned={handleTogglePinned}
      />
    </>
  );
}
