/**
 * MCP server editor dialog — popup form for adding/editing a single MCP server.
 * Extracted from McpPanel so the main page stays a clean list.
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  Field,
  Modal,
  Notice,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextArea,
  TextInput,
} from '@piwin/ui-kit';
import type { McpConfigDocument, McpServerConfig, McpToolSummary } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { McpToolCatalogRow } from './mcp-tool-catalog-row.js';
import { buildMcpToolCatalogEntries } from './mcp-visibility-model.js';
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
  onTestConnection: (
    serverId: string,
    config: McpServerConfig,
  ) => Promise<{ ok: boolean; message: string }>;
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
  const [fieldErrors, setFieldErrors] = useState<{ id?: string; command?: string }>({});
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tools, setTools] = useState<McpToolSummary[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [togglingPinSelector, setTogglingPinSelector] = useState<string | null>(null);
  const pinnedSelectors = props.document.pinnedSelectors ?? [];

  // Reset editor form when the dialog opens or the target server changes.
  // Intentionally does NOT depend on `document`: pin toggles update the
  // document and must not wipe the tools list mid-edit.
  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setFieldErrors({});
    setInfo(null);
    setTools([]);
    setTestingConnection(false);
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

  function clearFieldError(field: 'id' | 'command'): void {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /** Inline, per-field validation so errors sit next to the offending input. */
  function validateDraft(): boolean {
    const id = draft.id.trim();
    const next: { id?: string; command?: string } = {};
    if (!id) {
      next.id = isChinese ? '请填写服务器 ID。' : 'Server ID is required.';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      next.id = isChinese
        ? '只能包含字母、数字、- 和 _。'
        : 'Only letters, digits, - and _ are allowed.';
    }
    if (!draft.command.trim()) {
      next.command = isChinese ? '请填写命令。' : 'Command is required.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSaveForm(): Promise<void> {
    if (!validateDraft()) return;
    const id = draft.id.trim();
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
    if (!validateDraft()) return;
    const id = draft.id.trim();
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

  async function handleTestConnection(): Promise<void> {
    if (!validateDraft()) return;
    const id = draft.id.trim();
    setTestingConnection(true);
    setError(null);
    const result = await props.onTestConnection(id, draftToServer(draft));
    setTestingConnection(false);
    if (result.ok) {
      setInfo(result.message);
    } else {
      setError(result.message);
    }
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
  const catalogEntries = buildMcpToolCatalogEntries({
    serverId: draftServerId || 'server',
    tools: displayTools,
    pinnedSelectors,
    source: 'live',
  });
  const pinnedCountForServer = catalogEntries.filter(
    (entry) => entry.exposure === 'direct' || entry.exposure === 'dormant-pin',
  ).length;
  // Probing and testing both persist the draft server first, so both need a
  // complete id + command pair before they can run.
  const canProbe = draftServerId.length > 0 && draft.command.trim().length > 0;
  const probeRequirementHint = isChinese
    ? '先填写服务器 ID 与命令'
    : 'Fill in the server ID and command first';
  const pinnedCountLabel =
    tools.length > 0
      ? `${pinnedCountForServer}/${tools.length}`
      : pinnedCountForServer > 0
        ? isChinese
          ? `已固定 ${pinnedCountForServer}`
          : `${pinnedCountForServer} pinned`
        : null;

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
            {/* Enter in any single-line field saves, matching the rest of the settings dialogs. */}
            <div
              className="mcp-editor-body"
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) return;
                if ((event.target as HTMLElement).tagName !== 'INPUT') return;
                event.preventDefault();
                void handleSaveForm();
              }}
            >
              <div className="mcp-form-grid">
                <Field
                  label={isChinese ? '服务器 ID' : 'Server ID'}
                  description={
                    isChinese
                      ? '唯一名称，仅限字母、数字、- 和 _'
                      : 'Unique name: letters, digits, - and _'
                  }
                  error={fieldErrors.id ?? null}
                  required
                >
                  <TextInput
                    value={draft.id}
                    onChange={(event) => {
                      setDraft({ ...draft, id: event.currentTarget.value });
                      clearFieldError('id');
                    }}
                    placeholder="memory"
                    data-testid="mcp-editor-id"
                    autoFocus
                  />
                </Field>
                <Field
                  label={isChinese ? '命令' : 'Command'}
                  description={
                    isChinese ? '启动程序，如 npx、uvx、node' : 'Launcher, e.g. npx, uvx, node'
                  }
                  error={fieldErrors.command ?? null}
                  required
                >
                  <TextInput
                    value={draft.command}
                    onChange={(event) => {
                      setDraft({ ...draft, command: event.currentTarget.value });
                      clearFieldError('command');
                    }}
                    placeholder="npx"
                    data-testid="mcp-editor-command"
                  />
                </Field>
              </div>
              <Field
                label={isChinese ? '参数' : 'Args'}
                description={isChinese ? '以空格分隔' : 'Space-separated'}
              >
                <TextInput
                  value={draft.argsText}
                  onChange={(event) => setDraft({ ...draft, argsText: event.currentTarget.value })}
                  placeholder="-y @modelcontextprotocol/server-memory"
                  data-testid="mcp-editor-args"
                />
              </Field>
              <Field
                label={isChinese ? '环境变量' : 'Environment'}
                description={
                  isChinese
                    ? '每行一条 KEY=VALUE，可用 ${VAR} 引用系统变量'
                    : 'One KEY=VALUE per line; ${VAR} reads from the environment'
                }
              >
                <TextArea
                  rows={3}
                  value={draft.envText}
                  onChange={(nextValue) => setDraft({ ...draft, envText: nextValue })}
                  placeholder="API_KEY=${API_KEY}"
                  testId="mcp-editor-env"
                  nativeProps={{ spellCheck: false }}
                />
              </Field>
            </div>

            <section className="mcp-tools-preview" data-testid="mcp-tools-preview">
              <div className="mcp-tools-preview-header">
                <h5>{isChinese ? '工具固定（直调）' : 'Pin tools (direct call)'}</h5>
                {pinnedCountLabel ? (
                  <span className="mcp-tools-count" data-testid="mcp-editor-pin-count">
                    {pinnedCountLabel}
                  </span>
                ) : null}
                <div className="mcp-tools-preview-actions">
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={testingConnection || !canProbe}
                    title={canProbe ? undefined : probeRequirementHint}
                    onClick={() => void handleTestConnection()}
                    data-testid="mcp-editor-test-connection"
                  >
                    {testingConnection
                      ? isChinese
                        ? '测试中…'
                        : 'Testing…'
                      : isChinese
                        ? '测试连接'
                        : 'Test connection'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={loadingTools || !canProbe}
                    title={canProbe ? undefined : probeRequirementHint}
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
              </div>
              <p className="mcp-tools-preview-hint muted">
                {isChinese
                  ? '钉选的工具以 mcp__server__tool 直接暴露给 Agent；其余仍可通过 piwin_toolbox 搜索调用。'
                  : 'Pinned tools are exposed to the agent as mcp__server__tool; the rest stay reachable through piwin_toolbox.'}
              </p>
              {loadingTools && tools.length === 0 ? (
                <p className="mcp-tools-empty muted">
                  {isChinese ? '正在探测工具列表…' : 'Probing tools…'}
                </p>
              ) : null}
              {!loadingTools && displayTools.length === 0 ? (
                <p className="mcp-tools-empty muted">
                  {canProbe
                    ? isChinese
                      ? '点击「探测工具」列出该服务器的工具并固定高频项（会先保存当前配置）。'
                      : 'Click "Probe tools" to list this server\u2019s tools and pin the ones you use most (the config is saved first).'
                    : isChinese
                      ? '填写服务器 ID 与命令后，即可测试连接或探测工具。'
                      : 'Fill in the server ID and command to test the connection or probe tools.'}
                </p>
              ) : null}
              {catalogEntries.length > 0 ? (
                <ul className="mcp-tools-list mcp-tool-catalog-list">
                  {catalogEntries.map((entry) => (
                    <McpToolCatalogRow
                      key={entry.selector}
                      entry={entry}
                      isChinese={isChinese}
                      pinning={togglingPinSelector === entry.selector}
                      onTogglePinned={(selector, pinned) => {
                        void handleTogglePinned(selector, pinned);
                      }}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="raw" className="mcp-tab-content">
            <Field
              label="mcpServers"
              description={
                isChinese
                  ? '直接编辑 mcp.json 全文；保存前会自动校验结构。'
                  : 'Edit the whole mcp.json document; it is validated before saving.'
              }
              required
            >
              <TextArea
                rows={16}
                value={rawJson}
                onChange={setRawJson}
                testId="mcp-raw-json"
                nativeProps={{ spellCheck: false }}
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
