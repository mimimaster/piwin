/**
 * MCP server editor dialog — popup form for adding/editing a single MCP server.
 * Extracted from McpPanel so the main page stays a clean list.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button, Field, Modal, Notice, Tabs, TabsContent, TabsList, TabsTrigger, TextInput } from '@piwin/ui-kit';
import type { McpConfigDocument, McpServerConfig, McpToolSummary } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

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
  onValidateRaw: (document: unknown) => Promise<{ valid: boolean; document?: McpConfigDocument; issues?: Array<{ path: string; message: string }> }>;
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

function McpPinIcon({ pinned }: { pinned: boolean }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M5 2h6l-.7 3.3 2.2 2.2v1H8.7v4.5L8 14l-.7-1V8.5H3.5v-1l2.2-2.2L5 2Z"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

  // Reset state when dialog opens
  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setInfo(null);
    setTools([]);
    setTab('form');

    if (props.prefillDraft) {
      const id = props.prefillId ?? '';
      setDraft({
        id,
        command: props.prefillDraft.command,
        argsText: (props.prefillDraft.args ?? []).join(' '),
        envText: Object.entries(props.prefillDraft.env ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      });
    } else if (props.serverId && props.server) {
      setDraft(serverToDraft(props.serverId, props.server));
    } else {
      setDraft(emptyDraft());
    }
    setRawJson(`${JSON.stringify(props.document, null, 2)}\n`);
  }, [props.open, props.serverId, props.server, props.prefillDraft, props.prefillId, props.document]);

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

  const isEditing = Boolean(props.serverId);

  return (
    <Modal
      title={isEditing ? (isChinese ? '编辑服务器' : 'Edit Server') : (isChinese ? '添加服务器' : 'Add Server')}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="mcp-editor-dialog"
      size="lg"
    >
      <div className="cherry-dialog-body">
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
                <Field label={isChinese ? `环境变量（每行 KEY=VALUE，支持 ${'{ENV}'}）` : `Env (KEY=VALUE per line, supports ${'{ENV}'})`}>
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

              {tools.length > 0 ? (
                <section className="mcp-tools-preview">
                  <h5>{isChinese ? '工具预览' : 'Tools preview'}</h5>
                  <ul className="mcp-tools-list">
                    {tools.map((tool) => (
                      <li key={tool.exposedName} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Button
                          variant="ghost"
                          size="compact"
                          title={
                            (props.document.pinnedSelectors ?? []).includes(`${tool.serverId}.${tool.name}`)
                              ? isChinese
                                ? '取消固定直接调用'
                                : 'Unpin direct call'
                              : isChinese
                                ? '固定为直接调用工具'
                                : 'Pin as direct tool'
                          }
                          aria-label={
                            (props.document.pinnedSelectors ?? []).includes(`${tool.serverId}.${tool.name}`)
                              ? isChinese
                                ? '取消固定'
                                : 'Unpin'
                              : isChinese
                                ? '固定为直接调用工具'
                                : 'Pin as direct tool'
                          }
                          aria-pressed={(props.document.pinnedSelectors ?? []).includes(`${tool.serverId}.${tool.name}`)}
                          onClick={() => {
                            const selector = `${tool.serverId}.${tool.name}`;
                            const pinned = (props.document.pinnedSelectors ?? []).includes(selector);
                            void props.onTogglePinned(selector, !pinned);
                          }}
                        >
                          <McpPinIcon
                            pinned={(props.document.pinnedSelectors ?? []).includes(
                              `${tool.serverId}.${tool.name}`,
                            )}
                          />
                        </Button>
                        <span>
                          <strong>{tool.exposedName}</strong>
                          <span className="muted" style={{ display: 'block' }}>{tool.description || tool.name}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
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
                <Button
                  variant="ghost"
                  disabled={loadingTools}
                  onClick={() => void handlePreviewTools()}
                  data-testid="mcp-editor-tools"
                >
                  {loadingTools ? (isChinese ? '探测中…' : 'Probing…') : isChinese ? '工具' : 'Tools'}
                </Button>
                <span className="mcp-editor-spacer" />
                <Button onClick={() => props.onOpenChange(false)}>
                  {isChinese ? '取消' : 'Cancel'}
                </Button>
                <Button variant="primary" disabled={saving} onClick={() => void handleSaveForm()} data-testid="mcp-editor-save">
                  {saving ? (isChinese ? '保存中…' : 'Saving…') : (isChinese ? '保存' : 'Save')}
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
                <Button variant="primary" disabled={saving} onClick={() => void handleSaveRaw()} data-testid="mcp-editor-save-raw">
                  {saving ? (isChinese ? '保存中…' : 'Saving…') : (isChinese ? '保存 JSON' : 'Save JSON')}
                </Button>
              </>
            )}
          </div>
        </footer>
    </Modal>
  );
}
