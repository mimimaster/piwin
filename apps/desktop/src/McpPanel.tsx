import { useCallback, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
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
  const [tab, setTab] = useState<'form' | 'raw'>('form');
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

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

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
    setInfo(`Saved ${data.path}`);
    return true;
  }

  async function handleSaveForm(): Promise<void> {
    const id = draft.id.trim();
    if (!id) {
      setError('Server id is required');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setError('Server id must match [a-zA-Z0-9_-]+');
      return;
    }
    if (!draft.command.trim()) {
      setError('Command is required');
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
    if (!window.confirm(`Remove MCP server "${selectedServerId}"?`)) return;
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
      setError(parseError instanceof Error ? parseError.message : 'invalid JSON');
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
    setInfo('Valid mcp.json');
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
      setError('Select a server first');
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
        ? `Started ${data.health.serverId} (${data.health.toolCount} tools)`
        : `Start ${data.health.serverId}: ${data.health.status}${data.health.lastError ? ` — ${data.health.lastError}` : ''}`,
    );
  }

  async function handleStopServer(): Promise<void> {
    if (!selectedServerId) {
      setError('Select a server first');
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
    setInfo(`Stopped ${data.health.serverId}`);
  }

  async function handlePreviewTools(): Promise<void> {
    if (!selectedServerId) {
      setError('Select a server first');
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
        ? `No tools from ${selectedServerId}`
        : `Loaded ${data.tools.length} tool(s) from ${selectedServerId}`,
    );
  }

  const serverIds = Object.keys(document.mcpServers);

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>MCP</h3>
        <p className="muted">
          Cursor-compatible <code>mcpServers</code>. Path: <code>{path}</code>. Secrets stay as
          env values/refs — UI does not resolve them.
        </p>

        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as 'form' | 'raw')}>
          <Tabs.List className="segmented-control" aria-label="MCP editor mode">
            <Tabs.Trigger className="segmented-control-item" value="form">
              Form
            </Tabs.Trigger>
            <Tabs.Trigger className="segmented-control-item" value="raw">
              Raw JSON
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>

        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <p className="muted">{info}</p> : null}

        <h4>Servers</h4>
        <ul className="ext-list compact">
          {serverIds.length === 0 ? (
            <li className="muted">No servers configured</li>
          ) : (
            serverIds.map((serverId) => {
              const server = document.mcpServers[serverId];
              return (
                <li key={serverId}>
                  <button
                    type="button"
                    className={
                      selectedServerId === serverId ? 'session-item active' : 'session-item'
                    }
                    onClick={() => selectServer(serverId)}
                  >
                    {serverId} · {server?.disabled ? 'off' : 'on'} ·{' '}
                    {healthById[serverId]?.status ?? 'stopped'}
                    {healthById[serverId]?.toolCount
                      ? ` · ${healthById[serverId]?.toolCount} tools`
                      : ''}{' '}
                    · {server?.command}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSelectedServerId('');
            setDraft(emptyDraft());
            setTab('form');
          }}
        >
          New server
        </button>

        {tab === 'form' ? (
          <div className="settings-section">
            <h4>{selectedServerId ? 'Edit server' : 'Add server'}</h4>
            <label className="field">
              Server id
              <input
                value={draft.id}
                onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                placeholder="memory"
              />
            </label>
            <label className="field">
              Command
              <input
                value={draft.command}
                onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                placeholder="npx"
              />
            </label>
            <label className="field">
              Args (space-separated)
              <input
                value={draft.argsText}
                onChange={(event) => setDraft({ ...draft, argsText: event.target.value })}
                placeholder="-y @modelcontextprotocol/server-memory"
              />
            </label>
            <label className="field">
              Env (KEY=VALUE per line, supports ${'{ENV}'})
              <textarea
                className="mcp-raw-editor"
                rows={4}
                value={draft.envText}
                onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                placeholder="API_KEY=${API_KEY}"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.disabled}
                onChange={(event) => setDraft({ ...draft, disabled: event.target.checked })}
              />
              <span>Disabled</span>
            </label>
            <div className="row-actions">
              <button type="button" className="btn primary" onClick={() => void handleSaveForm()}>
                Save server
              </button>
              <button
                type="button"
                className="btn"
                disabled={!selectedServerId}
                onClick={() => void handleDeleteServer()}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!selectedServerId || lifecycleBusy}
                onClick={() => void handleStartServer()}
              >
                Start
              </button>
              <button
                type="button"
                className="btn"
                disabled={!selectedServerId || lifecycleBusy}
                onClick={() => void handleStopServer()}
              >
                Stop
              </button>
              <button
                type="button"
                className="btn"
                disabled={!selectedServerId || loadingTools}
                onClick={() => void handlePreviewTools()}
              >
                {loadingTools ? 'Probing…' : 'List tools'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={lifecycleBusy}
                onClick={() => void refreshHealth()}
              >
                Refresh status
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-section">
            <h4>Raw JSON</h4>
            <textarea
              className="mcp-raw-editor"
              rows={12}
              value={rawJson}
              onChange={(event) => setRawJson(event.target.value)}
              spellCheck={false}
            />
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn" onClick={() => void handleValidateRaw()}>
                Validate
              </button>
              <button type="button" className="btn primary" onClick={() => void handleSaveRaw()}>
                Save JSON
              </button>
            </div>
          </div>
        )}

        {tools.length > 0 ? (
          <>
            <h4>Tools preview</h4>
            <ul className="ext-list compact">
              {tools.map((tool) => (
                <li key={tool.exposedName} className="ext-list-item">
                  <div className="ext-list-main">
                    <strong>{tool.exposedName}</strong>
                    <div className="muted ext-desc">{tool.description || tool.name}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="manager-actions">
          <button type="button" className="btn" onClick={() => void loadConfig()}>
            Reload
          </button>
          {props.variant !== 'inline' ? (
            <button type="button" className="btn" onClick={props.onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
