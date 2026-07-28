import { useCallback, useEffect, useState } from 'react';
import { useDesktopLocale } from './desktop-locale-context';
import { useConfirmDialog } from './use-confirm-dialog';
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Field,
  Notice,
  Spinner,
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
  McpRegistryCard,
  McpValidateData,
} from '@piwin/contracts';
import { PageTitle } from './settings/page-title';
import { McpServerEditorDialog } from './McpServerEditorDialog';

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
  const [info, setInfo] = useState<string | null>(null);
  const [document, setDocument] = useState<McpConfigDocument>({ mcpServers: {} });
  const [healthById, setHealthById] = useState<Record<string, McpServerHealth>>({});
  const [loading, setLoading] = useState(true);

  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editServerId, setEditServerId] = useState('');
  const [editServer, setEditServer] = useState<McpServerConfig | undefined>(undefined);
  const [prefillDraft, setPrefillDraft] = useState<McpServerConfig | null>(null);
  const [prefillId, setPrefillId] = useState('');

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
    setInfo(null);
    const response = await props.request({ type: 'mcp/get' });
    if (!response.success) {
      setError(response.error);
      setLoading(false);
      return;
    }
    const data = response.data as McpGetData;
    setDocument(data.document);
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

  async function saveDocument(next: McpConfigDocument): Promise<boolean> {
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'mcp/save', document: next });
    if (!response.success) {
      setError(response.error);
      return false;
    }
    const data = response.data as { path: string; document: McpConfigDocument };
    setDocument(data.document);
    setInfo(isChinese ? `已保存 ${data.path}` : `Saved ${data.path}`);
    return true;
  }

  function openAddEditor(): void {
    setEditServerId('');
    setEditServer(undefined);
    setPrefillDraft(null);
    setPrefillId('');
    setEditorOpen(true);
  }

  function openEditEditor(serverId: string): void {
    setEditServerId(serverId);
    setEditServer(document.mcpServers[serverId]);
    setPrefillDraft(null);
    setPrefillId('');
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
    const ok = await saveDocument({ mcpServers: nextServers });
    if (ok) {
      await refreshHealth();
    }
    return ok;
  }

  async function handleValidateRawFromEditor(
    raw: unknown,
  ): Promise<{ valid: boolean; document?: McpConfigDocument; issues?: Array<{ path: string; message: string }> }> {
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

  async function handlePreviewToolsFromEditor(
    serverId: string,
    config: McpServerConfig,
  ): Promise<McpToolSummary[]> {
    // Temporarily save then probe, then restore? No — just probe via list_tools
    // which requires the server to exist. For new servers, we save first.
    const exists = Boolean(document.mcpServers[serverId]);
    if (!exists) {
      const nextServers = { ...document.mcpServers, [serverId]: config };
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
  }

  async function handleToggleServer(serverId: string, enable: boolean): Promise<void> {
    const server = document.mcpServers[serverId];
    if (!server) return;
    setError(null);
    setInfo(null);
    if (enable) {
      const nextServers = { ...document.mcpServers, [serverId]: { ...server, disabled: false } };
      if (!(await saveDocument({ mcpServers: nextServers }))) return;
      const response = await props.request({ type: 'mcp/start', serverId });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { health: McpServerHealth };
      setHealthById((current) => ({ ...current, [data.health.serverId]: data.health }));
    } else {
      const stopResponse = await props.request({ type: 'mcp/stop', serverId });
      if (stopResponse.success) {
        const data = stopResponse.data as { health: McpServerHealth };
        setHealthById((current) => ({ ...current, [data.health.serverId]: data.health }));
      }
      const nextServers = { ...document.mcpServers, [serverId]: { ...server, disabled: true } };
      await saveDocument({ mcpServers: nextServers });
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
    await saveDocument({ mcpServers: nextServers });
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
          <Tabs
            value={mainTab}
            onValueChange={(value) => setMainTab(value as 'configured' | 'registry')}
            testId="mcp-main-tabs"
          >
            <TabsList className="segmented-control" label={isChinese ? 'MCP 视图' : 'MCP views'}>
              <TabsTrigger value="configured" className="segmented-control-item" testId="mcp-tab-configured">
                {isChinese ? '已配置' : 'Configured'}
              </TabsTrigger>
              <TabsTrigger value="registry" className="segmented-control-item" testId="mcp-tab-registry">
                {isChinese ? '市场' : 'Marketplace'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="configured" className="mcp-tab-content">
              {error ? <Notice tone="error" title={isChinese ? 'MCP 操作失败' : 'MCP action failed'}>{error}</Notice> : null}
              {info ? <Notice tone="info">{info}</Notice> : null}

              <PageTitle
                title={isChinese ? 'MCP 服务器' : 'MCP Servers'}
                description={isChinese ? '管理本地 MCP 服务器配置。点击服务器编辑详情，或添加新服务器。' : 'Manage local MCP server configurations. Click a server to edit, or add a new one.'}
                trailing={
                  <Button size="compact" variant="primary" onClick={openAddEditor} data-testid="mcp-add-btn">
                    + {isChinese ? '添加' : 'Add'}
                  </Button>
                }
              />

              {loading ? (
                <div className="mcp-loading-state"><Spinner /></div>
              ) : serverIds.length === 0 ? (
                <div className="mcp-empty-list">
                  <p className="muted">{isChinese ? '尚未配置服务器。点击「添加」创建第一个 MCP 服务器。' : 'No servers configured. Click "Add" to create your first MCP server.'}</p>
                </div>
              ) : (
                <ul className="ext-list mcp-server-list-clean" data-testid="mcp-server-list">
                  {serverIds.map((serverId) => {
                    const server = document.mcpServers[serverId];
                    const health = healthById[serverId];
                    const runtimeStatus = health?.status ?? 'stopped';
                    const isEnabled = !server?.disabled;
                    const toolCount = health?.toolCount ?? 0;

                    return (
                      <li key={serverId} className="ext-list-item mcp-server-card" data-testid={`mcp-server-${serverId}`}>
                        <div className="mcp-server-card-body" onClick={() => openEditEditor(serverId)}>
                          <div className="mcp-server-card-title">
                            <span className={`mcp-status-dot-inline ${runtimeStatus}`} />
                            <strong>{serverId}</strong>
                            {!isEnabled && <span className="mcp-disabled-label">{isChinese ? '已禁用' : 'disabled'}</span>}
                          </div>
                          <div className="mcp-server-card-meta">
                            <code>{server?.command ?? ''}</code>
                            {toolCount > 0 && <span> · {isChinese ? `${toolCount} 个工具` : `${toolCount} tools`}</span>}
                          </div>
                        </div>
                        <div className="mcp-server-card-actions">
                          <span
                            role="switch"
                            aria-checked={isEnabled ? 'true' : 'false'}
                            tabIndex={0}
                            className={isEnabled ? 'mcp-toggle checked' : 'mcp-toggle'}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleToggleServer(serverId, !isEnabled);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleToggleServer(serverId, !isEnabled);
                              }
                            }}
                          />
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
              <PageTitle
                title={isChinese ? 'MCP 市场' : 'MCP Marketplace'}
                description={isChinese ? '从开放市场浏览并安装 MCP 服务器' : 'Browse and install MCP servers from the community.'}
              />
              <div className="mcp-marketplace-search">
                <Field label={isChinese ? '筛选' : 'Filter'}>
                  <input
                    data-testid="mcp-registry-search"
                    value={registryQuery}
                    onChange={(event) => setRegistryQuery(event.target.value)}
                    placeholder={isChinese ? '标题、ID 或描述…' : 'Search...'}
                  />
                </Field>
                <Button
                  size="compact"
                  data-testid="mcp-registry-refresh"
                  disabled={registryLoading}
                  onClick={() => void loadRegistry()}
                >
                  {registryLoading ? (isChinese ? '加载中...' : 'Loading...') : isChinese ? '刷新' : 'Refresh'}
                </Button>
              </div>
              {registryLoading && <div className="mcp-loading-state"><Spinner /></div>}
              <ul className="ext-list" data-testid="mcp-registry-list">
                {registryCards.length === 0 && !registryLoading ? (
                  <li className="mcp-empty-inline muted">{isChinese ? '未找到相关服务器' : 'No servers found'}</li>
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
        isChinese={isChinese}
        onSave={handleSaveFromEditor}
        onValidateRaw={handleValidateRawFromEditor}
        onSaveRaw={handleSaveRawFromEditor}
        onPreviewTools={handlePreviewToolsFromEditor}
      />
    </>
  );
}
