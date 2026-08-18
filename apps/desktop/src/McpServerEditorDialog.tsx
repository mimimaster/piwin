/**
 * MCP server editor dialog — popup form for adding/editing a single MCP server.
 * Extracted from McpPanel so the main page stays a clean list.
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  Field,
  IconButton,
  Modal,
  Notice,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextInput,
} from '@piwin/ui-kit';
import type { McpConfigDocument, McpServerConfig, McpToolSummary } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { IconPin } from './shell-icons';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export type McpServerEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When editing an existing server, its current id. Empty for "add new". */
  serverId: string;
  /** Current server config (when editing) or undefined (when adding). */
  server: McpServerConfig | undefined;
  /** Full document (for raw JSON tab). */
  document: McpConfigDocument;
  /** Pre-filled draft from marketplace install. */
  prefillDraft?: McpServerConfig | null;
  /** Pre-filled id from marketplace install. */
  prefillId?: string;
  isChinese: boolean;
  onSave: (id: string, config: McpServerConfig, originalId: string) => Promise<boolean>;
  onValidateRaw: (document: unknown) => Promise<{
    valid: boolean;
    document?: McpConfigDocument;
    issues?: Array<{ path: string; message: string }>;
  }>;
  onSaveRaw: (document: McpConfigDocument) => Promise<boolean>;
  onPreviewTools: (serverId: string, config: McpServerConfig) => Promise<McpToolSummary[]>;
  onTogglePinned: (selector: string, pinned: boolean) => Promise<boolean>;
};

type ServerFormDraft = {
  id: string;
  command: string;
  argsText: string;
  envText: string;
};

function emptyDraft(): ServerFormDraft {
  return { id: '', command: '', argsText: '', envText: '' };
}

function serverToDraft(id: string, server: McpServerConfig): ServerFormDraft {
  return {
    id,
    command: server.command,
    argsText: (server.args ?? []).join(' '),
    envText: Object.entries(server.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
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
  return config;
}

function formatToolSelector(serverId: string, toolName: string): string {
  return `${serverId}.${toolName}`;
}

export function McpServerEditorDialog(props: McpServerEditorDialogProps): ReactElement {
  const isChinese = props.isChinese;
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [draft, setDraft] = useState<ServerFormDraft>(emptyDraft());
  const [rawJson, setRawJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tools, setTools] = useState<McpToolSummary[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [togglingPinSelector, setTogglingPinSelector] = useState<string | null>(null);
  const pinnedSelectors = props.document.pinnedSelectors ?? [];

  // Reset editor form when the dialog opens or the target server changes.
  // Intentionally does NOT depend on `document`: pin toggles update the
  // document and must not wipe the tools list mid-edit.
  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setInfo(null);
    setTools([]);
    setTab('form');
    setTogglingPinSelector(null);

    if (props.prefillDraft) {
      const id = props.prefillId ?? '';
      setDraft({
        id,
        command: props.prefillDraft.command,
        argsText: (props.prefillDraft.args ?? []).join(' '),
        envText: Object.entries(props.prefillDraft.env ?? {})
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
      });
    } else if (props.serverId && props.server) {
      setDraft(serverToDraft(props.serverId, props.server));
    } else {
      setDraft(emptyDraft());
    }
    setRawJson(`${JSON.stringify(props.document, null, 2)}\n`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- document is intentionally omitted; pin saves must not reset the form
  }, [props.open, props.serverId, props.server, props.prefillDraft, props.prefillId]);

  // Keep raw JSON tab in sync when pins change while the dialog is open.
  useEffect(() => {
    if (!props.open || tab !== 'raw') return;
    setRawJson(`${JSON.stringify(props.document, null, 2)}\n`);
  }, [props.open, props.document, tab]);

  async function handleSaveForm(): Promise<void> {
    const id = draft.id.trim();
    if (!id) {
      setError(isChinese ? '请填写服务器 ID。' : 'Server ID is required.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setError(
        isChinese ? '服务器 ID 必须匹配 [a-zA-Z0-9_-]+。' : 'Server ID must match [a-zA-Z0-9_-]+.',
      );
      return;
    }
    if (!draft.command.trim()) {
      setError(isChinese ? '请填写命令。' : 'Command is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await props.onSave(id, draftToServer(draft), props.serverId);
    setSaving(false);
    if (ok) {
      props.onOpenChange(false);
    }
  }

  async function handleValidateRaw(): Promise<boolean> {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseError) {
      setError(formatError(parseError));
      return false;
    }
    const result = await props.onValidateRaw(parsed);
    if (!result.valid) {
      setError((result.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
      return false;
    }
    if (result.document) {
      setRawJson(`${JSON.stringify(result.document, null, 2)}\n`);
    }
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
    setSaving(true);
    const ok = await props.onSaveRaw(parsed as McpConfigDocument);
    setSaving(false);
    if (ok) {
      props.onOpenChange(false);
    }
  }

  async function handlePreviewTools(): Promise<void> {
    const id = draft.id.trim();
    if (!id) {
      setError(isChinese ? '请先填写服务器 ID。' : 'Enter a server ID first.');
      return;
    }
    setLoadingTools(true);
    setError(null);
    const result = await props.onPreviewTools(id, draftToServer(draft));
    setLoadingTools(false);
    setTools(result);
    setInfo(
      result.length === 0
        ? isChinese
          ? `${id} 未提供工具`
          : `No tools from ${id}`
        : isChinese
          ? `已从 ${id} 加载 ${result.length} 个工具`
          : `Loaded ${result.length} tool(s) from ${id}`,
    );
  }

  async function handleTogglePinned(selector: string, nextPinned: boolean): Promise<void> {
    setTogglingPinSelector(selector);
    setError(null);
    try {
      const ok = await props.onTogglePinned(selector, nextPinned);
      if (!ok) {
        setError(
          isChinese ? '固定状态保存失败，请重试。' : 'Failed to save pin state. Please try again.',
        );
      }
    } finally {
      setTogglingPinSelector(null);
    }
  }

  const isEditing = Boolean(props.serverId);
  const draftServerId = draft.id.trim();
  // Show already-pinned selectors for this server even before probing, so users
  // can unpin without starting the process.
  const dormantPinnedTools: McpToolSummary[] =
    draftServerId.length === 0
      ? []
      : pinnedSelectors
          .filter((selector) => selector.startsWith(`${draftServerId}.`))
          .filter(
            (selector) =>
              !tools.some((tool) => formatToolSelector(tool.serverId, tool.name) === selector),
          )
          .map((selector) => {
            const toolName = selector.slice(draftServerId.length + 1);
            return {
              serverId: draftServerId,
              name: toolName,
              exposedName: `mcp__${draftServerId}__${toolName}`,
              description: isChinese
                ? '已固定（尚未探测到当前工具列表）'
                : 'Pinned (not yet seen in the current tools probe)',
            };
          });
  const displayTools = [...tools, ...dormantPinnedTools];
  const pinnedCountForServer = displayTools.filter((tool) =>
    pinnedSelectors.includes(formatToolSelector(tool.serverId, tool.name)),
  ).length;

  return (
    <Modal
      title={
        isEditing
          ? isChinese
            ? '编辑服务器'
            : 'Edit Server'
          : isChinese
            ? '添加服务器'
            : 'Add Server'
      }
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="mcp-editor-dialog"
      size="lg"
    >
      <div className="cherry-dialog-body cherry-dialog--mcp-editor">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <Tabs value={tab} onValueChange={(value) => setTab(value as 'form' | 'raw')}>
          <TabsList className="segmented-control" label={isChinese ? '编辑模式' : 'Editor mode'}>
            <TabsTrigger className="segmented-control-item" value="form">
              {isChinese ? '表单' : 'Form'}
            </TabsTrigger>
            <TabsTrigger className="segmented-control-item" value="raw">
              Raw JSON
            </TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="mcp-tab-content">
            <div className="mcp-editor-body">
              <div className="mcp-form-grid">
                <Field label={isChinese ? '服务器 ID' : 'Server ID'} required>
                  <TextInput
                    value={draft.id}
                    onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })}
                    placeholder="memory"
                    data-testid="mcp-editor-id"
                    autoFocus
                  />
                </Field>
                <Field label={isChinese ? '命令' : 'Command'} required>
                  <TextInput
                    value={draft.command}
                    onChange={(event) => setDraft({ ...draft, command: event.currentTarget.value })}
                    placeholder="npx"
                    data-testid="mcp-editor-command"
                  />
                </Field>
              </div>
              <Field label={isChinese ? '参数（以空格分隔）' : 'Args (space-separated)'}>
                <TextInput
                  value={draft.argsText}
                  onChange={(event) => setDraft({ ...draft, argsText: event.currentTarget.value })}
                  placeholder="-y @modelcontextprotocol/server-memory"
                  data-testid="mcp-editor-args"
                />
              </Field>
              <Field
                label={
                  isChinese
                    ? `环境变量（每行 KEY=VALUE，支持 ${'{ENV}'}）`
                    : `Env (KEY=VALUE per line, supports ${'{ENV}'})`
                }
              >
                <textarea
                  className="mcp-raw-editor"
                  rows={5}
                  value={draft.envText}
                  onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                  placeholder="API_KEY=${API_KEY}"
                  data-testid="mcp-editor-env"
                />
              </Field>
            </div>

            <section className="mcp-tools-preview" data-testid="mcp-tools-preview">
              <div className="mcp-tools-preview-header">
                <h5>
                  {isChinese ? '工具固定（直调）' : 'Pin tools (direct call)'}
                  {tools.length > 0
                    ? ` · ${pinnedCountForServer}/${tools.length}`
                    : pinnedCountForServer > 0
                      ? isChinese
                        ? ` · 已固定 ${pinnedCountForServer}`
                        : ` · ${pinnedCountForServer} pinned`
                      : null}
                </h5>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={loadingTools || !draft.id.trim()}
                  onClick={() => void handlePreviewTools()}
                  data-testid="mcp-editor-tools"
                  data-activity-id="mcp.discovery"
                  data-activity-animation={getBehaviorActivitySpec('mcp.discovery').animation}
                  data-tool-status={loadingTools ? 'running' : 'done'}
                >
                  {loadingTools
                    ? isChinese
                      ? '探测中…'
                      : 'Probing…'
                    : isChinese
                      ? '探测工具'
                      : 'Probe tools'}
                </Button>
              </div>
              <p className="mcp-tools-preview-hint muted">
                {isChinese
                  ? '钉选后以 mcp__server__tool 直接暴露给 Agent。未钉选的工具仍可通过 piwin_toolbox（search → call）调用。'
                  : 'Pinned tools appear as mcp__server__tool for the agent. Unpinned tools stay reachable via piwin_toolbox (search → call).'}
              </p>
              {loadingTools && tools.length === 0 ? (
                <p className="mcp-tools-empty muted">
                  {isChinese ? '正在加载工具列表…' : 'Loading tools…'}
                </p>
              ) : null}
              {!loadingTools && displayTools.length === 0 ? (
                <p className="mcp-tools-empty muted">
                  {isChinese
                    ? '尚未加载工具。保存服务器后点击「探测工具」以列出并固定高频工具。'
                    : 'No tools loaded yet. Save the server, then click "Probe tools" to list and pin high-frequency tools.'}
                </p>
              ) : null}
              {displayTools.length > 0 ? (
                <ul className="mcp-tools-list">
                  {displayTools.map((tool) => {
                    const selector = formatToolSelector(tool.serverId, tool.name);
                    const isPinned = pinnedSelectors.includes(selector);
                    const pinLabel = isPinned
                      ? isChinese
                        ? '取消固定直接调用'
                        : 'Unpin direct call'
                      : isChinese
                        ? '固定为直接调用工具'
                        : 'Pin as direct tool';
                    return (
                      <li key={tool.exposedName} className="mcp-tool-row">
                        <IconButton
                          className={
                            isPinned
                              ? 'mcp-tool-pin-btn mcp-tool-pin-btn--active'
                              : 'mcp-tool-pin-btn'
                          }
                          label={pinLabel}
                          title={pinLabel}
                          aria-pressed={isPinned}
                          disabled={togglingPinSelector === selector}
                          data-testid={`mcp-pin-${selector}`}
                          onClick={() => {
                            void handleTogglePinned(selector, !isPinned);
                          }}
                        >
                          <IconPin
                            className={
                              isPinned
                                ? 'mcp-tool-pin-icon mcp-tool-pin-icon--filled'
                                : 'mcp-tool-pin-icon'
                            }
                            width={16}
                            height={16}
                          />
                        </IconButton>
                        <div className="mcp-tool-row-body">
                          <div className="mcp-tool-row-title">
                            <strong>{tool.exposedName}</strong>
                            {isPinned ? (
                              <span className="mcp-tool-pin-pill">
                                {isChinese ? '直调' : 'direct'}
                              </span>
                            ) : (
                              <span className="mcp-tool-gateway-pill">gateway</span>
                            )}
                          </div>
                          <span className="muted mcp-tool-row-desc">
                            {tool.description || tool.name}
                          </span>
                          <code className="mcp-tool-selector muted">{selector}</code>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="raw" className="mcp-tab-content">
            <Field label="mcpServers" required>
              <textarea
                className="mcp-raw-editor mcp-raw-document"
                rows={16}
                value={rawJson}
                onChange={(event) => setRawJson(event.target.value)}
                spellCheck={false}
                data-testid="mcp-raw-json"
              />
            </Field>
          </TabsContent>
        </Tabs>
      </div>

      <footer className="cherry-dialog-footer">
        <div className="mcp-editor-actions">
          {tab === 'form' ? (
            <>
              <span className="mcp-editor-spacer" />
              <Button onClick={() => props.onOpenChange(false)}>
                {isChinese ? '取消' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void handleSaveForm()}
                data-testid="mcp-editor-save"
              >
                {saving ? (isChinese ? '保存中…' : 'Saving…') : isChinese ? '保存' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => void handleValidateRaw()} data-testid="mcp-editor-validate">
                {isChinese ? '验证' : 'Validate'}
              </Button>
              <span className="mcp-editor-spacer" />
              <Button onClick={() => props.onOpenChange(false)}>
                {isChinese ? '取消' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void handleSaveRaw()}
                data-testid="mcp-editor-save-raw"
              >
                {saving
                  ? isChinese
                    ? '保存中…'
                    : 'Saving…'
                  : isChinese
                    ? '保存 JSON'
                    : 'Save JSON'}
              </Button>
            </>
          )}
        </div>
      </footer>
    </Modal>
  );
}
