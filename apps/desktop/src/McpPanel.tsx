import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktopLocale } from './desktop-locale-context';
import { mcpConfigSavedEffectMessage } from './settings-effect-copy.js';
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
  McpValidateData,
} from '@piwin/contracts';
import { PageTitle } from './settings/page-title';
import { CapabilityDiscoveryHint } from './settings/capability-discovery-hint';
import { McpServerEditorDialog } from './McpServerEditorDialog';
import { McpServerDetailPanel } from './mcp-server-detail-panel.js';
import {
  buildMcpToolCatalogEntries,
  getMcpConnectionFailure,
  resolveMcpServerRuntimeUiStatus,
} from './mcp-visibility-model.js';
import { IconPin, IconChevronDown, IconChevronRight } from './shell-icons';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export type McpPanelProps = {
  request: (command: {
    type:
      | 'mcp/get'
      | 'mcp/validate'
      | 'mcp/save'
      | 'mcp/list_tools'
      | 'mcp/status'
      | 'mcp/start'
      | 'mcp/stop';
    document?: unknown;
    serverId?: string;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function McpPanel(props: McpPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const confirmDialog = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<McpConfigDocument>({
    mcpServers: {},
    pinnedSelectors: [],
  });
  const documentRef = useRef(document);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const [healthById, setHealthById] = useState<Record<string, McpServerHealth>>({});
  const [pinningServerId, setPinningServerId] = useState<string | null>(null);
  const [pinningSelector, setPinningSelector] = useState<string | null>(null);
  const [startingServerId, setStartingServerId] = useState<string | null>(null);
  const [stoppingServerId, setStoppingServerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [toolsByServerId, setToolsByServerId] = useState<Record<string, McpToolSummary[]>>({});
  const [toolsLoadingId, setToolsLoadingId] = useState<string | null>(null);
  const [toolsErrorById, setToolsErrorById] = useState<Record<string, string>>({});

  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false);
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

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

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
      message: mcpConfigSavedEffectMessage(locale, data.path),
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
    setPinningSelector(selector);
    try {
      return await saveDocument(nextDocument);
    } finally {
      setPinningSelector(null);
    }
  }

  const loadServerTools = useCallback(
    async (serverId: string): Promise<void> => {
      setToolsLoadingId(serverId);
      setToolsErrorById((current) => {
        if (!(serverId in current)) return current;
        const next = { ...current };
        delete next[serverId];
        return next;
      });
      const response = await props.request({ type: 'mcp/list_tools', serverId });
      setToolsLoadingId(null);
      if (!response.success) {
        setToolsErrorById((current) => ({ ...current, [serverId]: response.error }));
        setToolsByServerId((current) =>
          current[serverId] !== undefined ? current : { ...current, [serverId]: [] },
        );
        return;
      }
      const data = response.data as McpListToolsData;
      setToolsByServerId((current) => ({ ...current, [serverId]: data.tools ?? [] }));
      await refreshHealth();
    },
    [props, refreshHealth],
  );

  function toggleServerExpanded(serverId: string): void {
    setExpandedServerId((current) => (current === serverId ? null : serverId));
  }

  useEffect(() => {
    if (expandedServerId === null) return;
    if (toolsByServerId[expandedServerId] !== undefined) return;
    if (toolsLoadingId === expandedServerId) return;
    void loadServerTools(expandedServerId);
  }, [expandedServerId, loadServerTools, toolsByServerId, toolsLoadingId]);

  async function handleToggleServerPinned(serverId: string): Promise<void> {
    const currentDocument = documentRef.current;
    const server = currentDocument.mcpServers[serverId];
    if (!server) return;

    const currentPins = currentDocument.pinnedSelectors ?? [];
    const serverPinPrefix = `${serverId}.`;
    const serverPins = currentPins.filter((selector) => selector.startsWith(serverPinPrefix));
    setPinningServerId(serverId);
    setError(null);

    try {
      if (serverPins.length > 0) {
        const nextPins = currentPins.filter((selector) => !selector.startsWith(serverPinPrefix));
        const saved = await saveDocument({
          mcpServers: currentDocument.mcpServers,
          pinnedSelectors: nextPins,
        });
        if (saved) {
          showUiNotification({
            tone: 'success',
            message: isChinese ? `已取消固定 ${serverId}` : `Unpinned ${serverId}`,
            autoClose: 3000,
          });
        }
        return;
      }

      const response = await props.request({ type: 'mcp/list_tools', serverId });
      if (!response.success) {
        setError(response.error);
        showUiNotification({
          tone: 'error',
          title: isChinese ? '固定 MCP 工具失败' : 'Failed to pin MCP tools',
          message: response.error,
          autoClose: 5000,
        });
        return;
      }

      const data = response.data as McpListToolsData;
      const selectors = (data.tools ?? []).map((tool) => `${serverId}.${tool.name}`);
      if (selectors.length === 0) {
        showUiNotification({
          tone: 'warning',
          message: isChinese
            ? `${serverId} 当前没有可固定的工具`
            : `${serverId} has no tools available to pin`,
          autoClose: 4000,
        });
        return;
      }

      const nextPins = [...new Set([...currentPins, ...selectors])];
      const saved = await saveDocument({
        mcpServers: currentDocument.mcpServers,
        pinnedSelectors: nextPins,
      });
      if (saved) {
        showUiNotification({
          tone: 'success',
          message: isChinese
            ? `已固定 ${serverId} 的 ${selectors.length} 个工具`
            : `Pinned ${selectors.length} tool(s) from ${serverId}`,
          autoClose: 3000,
        });
      }
    } finally {
      setPinningServerId(null);
    }
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

  const handleTestConnectionFromEditor = useCallback(
    async (
      serverId: string,
      config: McpServerConfig,
    ): Promise<{ ok: boolean; message: string }> => {
      const currentDocument = documentRef.current;
      const nextServers = { ...currentDocument.mcpServers, [serverId]: config };
      const ok = await saveDocument({ mcpServers: nextServers });
      if (!ok) {
        return {
          ok: false,
          message: isChinese ? '保存服务器配置失败。' : 'Failed to save server config.',
        };
      }
      const response = await props.request({ type: 'mcp/start', serverId });
      if (!response.success) {
        return {
          ok: false,
          message: response.error ?? (isChinese ? '连接失败。' : 'Connection failed.'),
        };
      }
      const data = response.data as { health?: McpServerHealth };
      if (data.health) {
        const health = data.health;
        setHealthById((current) => ({ ...current, [health.serverId]: health }));
      }
      const failure = getMcpConnectionFailure(data.health, isChinese);
      if (failure) return { ok: false, message: failure };
      return {
        ok: true,
        message: isChinese ? `已连接到 ${serverId}` : `Connected to ${serverId}`,
      };
    },
    // saveDocument closes over documentRef; request + locale are the inputs.
    [isChinese, locale, props.request],
  );

  async function handleToggleServer(serverId: string, enable: boolean): Promise<void> {
    const server = document.mcpServers[serverId];
    if (!server) return;
    setError(null);
    if (enable) {
      setStartingServerId(serverId);
      try {
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
        const failure = getMcpConnectionFailure(data.health, isChinese);
        if (failure) {
          showUiNotification({
            tone: 'error',
            title: isChinese ? '启动 MCP 服务器失败' : 'Failed to start MCP server',
            message: failure,
            autoClose: 5000,
          });
          return;
        }
        showUiNotification({
          tone: 'success',
          message: isChinese ? `已启动 ${serverId}` : `Started ${serverId}`,
          autoClose: 3000,
        });
      } finally {
        setStartingServerId(null);
      }
    } else {
      setStoppingServerId(serverId);
      try {
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
      } finally {
        setStoppingServerId(null);
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
          <div data-testid="mcp-main">
            {props.variant !== 'inline' ? (
              <PageTitle
                title={isChinese ? 'MCP 服务器' : 'MCP Servers'}
                description={
                  isChinese
                    ? '管理本地 MCP 服务器。打开服务器可固定直调工具；未固定工具由 Agent 通过 piwin_toolbox 搜索并调用。'
                    : 'Manage local MCP servers. Open a server to pin direct tools; unpinned tools are called via piwin_toolbox.'
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
              <span className="mcp-configured-count" data-testid="mcp-configured-count">
                {isChinese ? `已配置 ${serverIds.length} 个` : `${serverIds.length} configured`}
              </span>
              <Button
                size="compact"
                variant="primary"
                onClick={openAddEditor}
                data-testid="mcp-add-btn"
              >
                + {isChinese ? '添加服务器' : 'Add Server'}
              </Button>
            </div>

            <CapabilityDiscoveryHint kind="mcp" />
            <div className="mcp-tab-content">
              <div className="mcp-pin-tip">
                <Notice
                  tone="info"
                  title={isChinese ? '固定 MCP 工具会发生什么？' : 'What does pinning MCP tools do?'}
                  testId="mcp-pin-tip"
                >
                  {isChinese
                    ? 'Pin 后，该服务器当前发现的工具会直接暴露给 Agent，可直接调用；未 Pin 的工具仍通过 piwin_toolbox 按需搜索和调用。首次点击 Pin 会探测工具列表，取消 Pin 后恢复为目录调用。'
                    : 'Pinning directly exposes the server’s discovered tools to the Agent for direct calls. Unpinned tools remain available through piwin_toolbox on demand. The first pin probes the tool list; unpinning restores catalog-only access.'}
                </Notice>
              </div>

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
                    if (!server) return null;
                    const health = healthById[serverId];
                    const isEnabled = !server.disabled;
                    const runtimeStatus = resolveMcpServerRuntimeUiStatus({
                      enabled: isEnabled,
                      health,
                    });
                    const toolCount = health?.toolCount ?? toolsByServerId[serverId]?.length ?? 0;
                    const fullCommand = [server.command, ...(server.args ?? [])]
                      .filter(Boolean)
                      .join(' ');
                    const envCount = Object.keys(server.env ?? {}).length;
                    const pinPrefix = `${serverId}.`;
                    const pinnedCount = (document.pinnedSelectors ?? []).filter((selector) =>
                      selector.startsWith(pinPrefix),
                    ).length;
                    const expanded = expandedServerId === serverId;
                    const catalogEntries = buildMcpToolCatalogEntries({
                      serverId,
                      tools: toolsByServerId[serverId] ?? [],
                      pinnedSelectors: document.pinnedSelectors ?? [],
                      source: 'live',
                    });
                    const serverActivityId =
                      stoppingServerId === serverId
                        ? 'mcp.server.stop'
                        : startingServerId === serverId
                          ? 'mcp.server.connect'
                          : pinningServerId === serverId
                            ? 'mcp.discovery'
                            : runtimeStatus === 'starting'
                              ? 'mcp.server.connect'
                              : 'mcp.server.status';
                    const serverActivitySpec = getBehaviorActivitySpec(serverActivityId);
                    const serverActivityStatus =
                      stoppingServerId === serverId ||
                      startingServerId === serverId ||
                      pinningServerId === serverId ||
                      runtimeStatus === 'starting'
                        ? 'running'
                        : runtimeStatus === 'error'
                          ? 'error'
                          : 'done';

                    return (
                      <li
                        key={serverId}
                        className={`ext-list-item mcp-server-card${expanded ? ' is-expanded' : ''}`}
                        data-testid={`mcp-server-${serverId}`}
                        data-activity-id={serverActivityId}
                        data-activity-animation={serverActivitySpec.animation}
                        data-tool-status={serverActivityStatus}
                      >
                        <div className="mcp-server-card-summary">
                          <button
                            type="button"
                            className="mcp-server-card-body"
                            aria-expanded={expanded}
                            data-testid={`mcp-server-expand-${serverId}`}
                            onClick={() => toggleServerExpanded(serverId)}
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
                              <span className="mcp-server-expand-chevron" aria-hidden>
                                {expanded ? <IconChevronDown /> : <IconChevronRight />}
                              </span>
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
                          </button>
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
                                pinnedCount > 0
                                  ? isChinese
                                    ? `取消固定 ${serverId} 的全部工具`
                                    : `Unpin all tools from ${serverId}`
                                  : isChinese
                                    ? `固定 ${serverId} 的全部工具`
                                    : `Pin all tools from ${serverId}`
                              }
                              title={
                                pinnedCount > 0
                                  ? isChinese
                                    ? `${pinnedCount} 个工具已固定，点击取消固定`
                                    : `${pinnedCount} tool(s) pinned; click to unpin`
                                  : isChinese
                                    ? '点击直接固定该服务器的全部工具'
                                    : 'Click to directly pin all tools from this server'
                              }
                              className={
                                pinnedCount > 0
                                  ? 'mcp-server-pin-btn mcp-server-pin-btn--active'
                                  : 'mcp-server-pin-btn'
                              }
                              aria-pressed={pinnedCount > 0}
                              disabled={pinningServerId === serverId}
                              data-testid={`mcp-server-pin-trigger-${serverId}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleServerPinned(serverId);
                              }}
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
                        </div>
                        {expanded ? (
                          <McpServerDetailPanel
                            serverId={serverId}
                            server={server}
                            health={health}
                            tools={catalogEntries}
                            toolsLoading={toolsLoadingId === serverId}
                            toolsError={toolsErrorById[serverId] ?? null}
                            toolsSource={
                              toolsByServerId[serverId] !== undefined ? 'live' : null
                            }
                            isChinese={isChinese}
                            onRefreshTools={() => {
                              void loadServerTools(serverId);
                            }}
                            onOpenEditor={() => openEditEditor(serverId)}
                            onTogglePinned={(selector, pinned) => {
                              void handleTogglePinned(selector, pinned);
                            }}
                            pinningSelector={pinningSelector}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
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
        onTestConnection={handleTestConnectionFromEditor}
        onTogglePinned={handleTogglePinned}
      />
    </>
  );
}
