import { useCallback, useEffect, useState } from 'react';
import { Button, TextInput, TextArea } from '@piwin/ui-kit';
import type {
  HostResponse,
  NoteRecord,
  NoteSearchHit,
  NoteSearchMode,
  RecallEvalReport,
} from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { copyToClipboard, downloadFile } from './knowledge-export';

export type NotesPanelProps = {
  request: (command:
    | { type: 'notes/list'; collection?: string }
    | { type: 'notes/read'; noteId: string }
    | { type: 'notes/search'; query: { query: string; limit?: number; mode?: NoteSearchMode } }
    | { type: 'notes/write'; input: { title: string; content: string; collection?: string; tags?: string[] } }
    | {
        type: 'notes/update';
        input: { id: string; title?: string; content?: string; expectedContentHash?: string };
      }
    | { type: 'notes/delete'; noteId: string; expectedContentHash?: string }
    | { type: 'notes/reindex' }
    | { type: 'notes/eval-run'; k?: number }
    | { type: 'notes/eval-history' }
  ) => Promise<HostResponse>;
  onSendToChat?: (text: string) => void;
  readOnly?: boolean;
};

/**
 * Notes library panel (ADR 0018 S6): list / hybrid search with channel badges /
 * view / edit / create / delete / reindex / retrieval-quality report.
 */
export function NotesPanel(props: NotesPanelProps) {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [records, setRecords] = useState<NoteRecord[]>([]);
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null);
  const [selected, setSelected] = useState<NoteRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<NoteSearchMode>('auto');
  const [evalReports, setEvalReports] = useState<RecallEvalReport[] | null>(null);
  const [evalHistory, setEvalHistory] = useState<RecallEvalReport[] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const request = props.request;
  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await request({ type: 'notes/list' });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { records: NoteRecord[] };
    setRecords(data.records ?? []);
  }, [request]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  async function handleSearch(): Promise<void> {
    setError(null);
    const query = searchQuery.trim();
    if (!query) {
      setHits(null);
      return;
    }
    const response = await props.request({
      type: 'notes/search',
      query: { query, limit: 20, mode: searchMode },
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { hits: NoteSearchHit[] };
    setHits(data.hits ?? []);
  }

  async function handleOpen(noteId: string): Promise<void> {
    setError(null);
    const response = await props.request({ type: 'notes/read', noteId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { record: NoteRecord };
    setSelected(data.record);
    setEditing(false);
    setCreating(false);
  }

  async function handleSave(input: { title: string; content: string }): Promise<void> {
    setBusy(true);
    setError(null);
    const response = creating
      ? await props.request({ type: 'notes/write', input })
      : await props.request({
          type: 'notes/update',
          input: {
            id: selected?.id ?? '',
            ...input,
            ...(selected?.contentHash === undefined
              ? {}
              : { expectedContentHash: selected.contentHash }),
          },
        });
    setBusy(false);
    if (!response.success) {
      if (response.problem?.code === 'notes-revision-conflict' && selected) {
        setError(t('Another client changed this note.', '这条笔记已被另一端改过'));
        await handleOpen(selected.id);
        return;
      }
      setError(response.error);
      return;
    }
    const data = response.data as { record: NoteRecord };
    setSelected(data.record);
    setEditing(false);
    setCreating(false);
    setInfo(creating ? t('Note created', '笔记已创建') : t('Note saved', '笔记已保存'));
    await loadNotes();
  }

  async function handleDelete(noteId: string): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await props.request({
      type: 'notes/delete',
      noteId,
      ...(selected?.id === noteId && selected.contentHash
        ? { expectedContentHash: selected.contentHash }
        : {}),
    });
    setBusy(false);
    if (!response.success) {
      if (response.problem?.code === 'notes-revision-conflict') {
        setError(t('Another client changed this note.', '这条笔记已被另一端改过'));
        await handleOpen(noteId);
        return;
      }
      setError(response.error);
      return;
    }
    setSelected(null);
    setInfo(t('Note deleted', '笔记已删除'));
    await loadNotes();
  }

  async function handleReindex(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await props.request({ type: 'notes/reindex' });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(t('Index rebuilt successfully', '知识索引已重建完成'));
  }

  async function handleEvalRun(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await props.request({ type: 'notes/eval-run', k: 5 });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { reports: RecallEvalReport[] };
    setEvalReports(data.reports ?? []);
  }

  async function handleEvalHistory(): Promise<void> {
    if (evalHistory !== null) {
      setEvalHistory(null);
      return;
    }
    setError(null);
    const response = await props.request({ type: 'notes/eval-history' });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { runs: RecallEvalReport[] };
    setEvalHistory(data.runs ?? []);
  }

  const handleCopyNote = async () => {
    if (!selected) return;
    const md = `# ${selected.title}\n\n${selected.content}`;
    const ok = await copyToClipboard(md);
    if (ok) setInfo(t('Note copied to clipboard', '已复制笔记内容到剪贴板'));
  };

  const handleDownloadNote = () => {
    if (!selected) return;
    const md = `# ${selected.title}\n\n${selected.content}`;
    downloadFile(md, `${selected.title}.md`, 'text/markdown');
    setInfo(t('Note exported as .md file', '已导出为 .md 文件'));
  };

  const handleSendNoteToChat = () => {
    if (!selected || !props.onSendToChat) return;
    const prompt = isZh
      ? `请围绕以下笔记内容进行分析与解答：\n\n### 笔记：《${selected.title}》\n${selected.content}\n\n我的问题：`
      : `Based on this note "${selected.title}":\n\n${selected.content}\n\nMy question: `;
    props.onSendToChat(prompt);
  };

  const displayList = hits !== null ? hits.map((hit) => hit.note) : records;

  return (
    <div className="notes-panel-container" data-testid="notes-panel">
      {/* Top Search & Actions Bar */}
      <div className="notes-toolbar-card">
        <div className="notes-search-row">
          <div className="notes-search-input-wrap">
            <TextInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSearch();
              }}
              placeholder={t('Search notes… (CJK hybrid vector & keyword)', '搜索本地笔记… (支持 CJK 向量与全文混合检索)')}
              data-testid="notes-search-input"
            />
          </div>
          <select
            className="notes-mode-select"
            value={searchMode}
            onChange={(event) => setSearchMode(event.target.value as NoteSearchMode)}
            data-testid="notes-search-mode"
            title={t('Retrieval mode', '检索模式')}
          >
            <option value="auto">{t('Auto (Hybrid)', '智能混合 (Auto)')}</option>
            <option value="fts">{t('Full-text (FTS)', '仅全文 (FTS)')}</option>
            <option value="vector">{t('Vector Only', '仅向量 (Vector)')}</option>
            <option value="hybrid">{t('Force Hybrid', '强制混合 (Hybrid)')}</option>
          </select>
          <Button variant="primary" onClick={() => void handleSearch()}>
            🔍 {t('Search', '检索')}
          </Button>
          {searchQuery && (
            <Button
              variant="ghost"
              onClick={() => {
                setHits(null);
                setSearchQuery('');
                void loadNotes();
              }}
            >
              {t('Clear', '重置')}
            </Button>
          )}
        </div>

        <div className="notes-actions-row">
          <Button
            variant="primary"
            data-testid="notes-new"
            disabled={props.readOnly}
            onClick={() => {
              setSelected(null);
              setCreating(true);
              setEditing(true);
            }}
          >
            📝 {t('New Note', '新建笔记')}
          </Button>
          <Button
            disabled={busy || props.readOnly}
            variant="secondary"
            onClick={() => void handleReindex()}
          >
            ⚡ {t('Rebuild Index', '重建索引')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowAdvanced((prev) => !prev)}
          >
            🛠️ {showAdvanced ? t('Hide Advanced', '收起高级') : t('Advanced / Eval', '高级 / 召回评测')}
          </Button>
        </div>
      </div>

      {/* Advanced Eval collapsible */}
      {showAdvanced && (
        <div className="notes-advanced-card">
          <div className="notes-eval-buttons">
            <Button
              size="compact"
              disabled={busy || props.readOnly}
              onClick={() => void handleEvalRun()}
            >
              ▶️ {t('Run Recall Benchmark (k=5)', '运行召回质量评测')}
            </Button>
            <Button
              size="compact"
              variant="ghost"
              disabled={props.readOnly}
              onClick={() => void handleEvalHistory()}
            >
              📊 {evalHistory !== null ? t('Hide History', '隐藏历史') : t('Eval History', '评测历史记录')}
            </Button>
          </div>

          {evalReports && (
            <div data-testid="notes-eval-report" className="notes-eval-results">
              <strong>{t('Retrieval Quality (recall@5 / MRR):', '检索质量报告 (recall@5 / MRR)：')}</strong>
              <ul>
                {evalReports.map((report) => (
                  <li key={report.mode}>
                    <span>{report.mode}</span>: recall {report.recallAtK.toFixed(3)} · mrr {report.mrr.toFixed(3)} ·{' '}
                    {report.cases} {t('cases', '个用例')}
                    {report.degraded ? (
                      <span className="doc-cards-degraded-tag" title={t('Embedding failed; numbers are FTS results', '向量失败；降级为全文检索')}>
                        {t('Degraded', '已降级')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evalHistory !== null && (
            <div data-testid="notes-eval-history" className="notes-eval-results">
              <strong>{t('Benchmark Run History:', '历史评测运行记录：')}</strong>
              {evalHistory.length === 0 ? (
                <p className="muted">{t('No runs yet — run a recall eval first.', '暂无记录，请先点击运行召回质量评测。')}</p>
              ) : (
                <ul>
                  {evalHistory.map((run, index) => (
                    <li key={`${run.runAt}-${index}`}>
                      {run.runAt.slice(0, 16).replace('T', ' ')} · {run.mode} · recall@{run.k}{' '}
                      {run.recallAtK.toFixed(3)} · mrr {run.mrr.toFixed(3)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="doc-cards-error-banner" role="alert">⚠️ {error}</div>}
      {info && <div className="doc-cards-info-banner" role="status">ℹ️ {info}</div>}

      {/* Note Editor */}
      {editing ? (
        <NoteEditor
          initialTitle={creating ? '' : selected?.title ?? ''}
          initialContent={creating ? '' : selected?.content ?? ''}
          busy={busy}
          isZh={isZh}
          onSave={(input) => void handleSave(input)}
          onCancel={() => {
            setEditing(false);
            setCreating(false);
          }}
        />
      ) : selected ? (
        /* Note Detail View */
        <div className="notes-detail-card" data-testid="notes-detail">
          <header className="notes-detail-header">
            <div>
              <h3>{selected.title}</h3>
              <div className="notes-detail-meta">
                <span className="notes-collection-badge">📁 {selected.collection || 'default'}</span>
                {selected.tags && selected.tags.length > 0 && (
                  <span className="notes-tags-list">🏷️ {selected.tags.join(', ')}</span>
                )}
              </div>
            </div>
            <div className="notes-detail-actions">
              {props.onSendToChat && (
                <Button size="compact" variant="primary" onClick={handleSendNoteToChat} title={t('Discuss in Chat', '在对话中讨论此笔记')}>
                  💬 {t('Discuss in Chat', '在对话中研讨')}
                </Button>
              )}
              <Button size="compact" variant="secondary" onClick={handleCopyNote} title={t('Copy Markdown', '复制 Markdown')}>
                📋 {t('Copy', '复制')}
              </Button>
              <Button size="compact" variant="secondary" onClick={handleDownloadNote} title={t('Export as Markdown', '导出为 Markdown')}>
                📄 {t('Export .MD', '导出 MD')}
              </Button>
              <Button
                size="compact"
                variant="secondary"
                disabled={props.readOnly}
                onClick={() => setEditing(true)}
              >
                ✏️ {t('Edit', '编辑')}
              </Button>
              <Button
                size="compact"
                variant="ghost"
                disabled={busy || props.readOnly}
                onClick={() => void handleDelete(selected.id)}
              >
                🗑️ {t('Delete', '删除')}
              </Button>
              <Button size="compact" variant="ghost" onClick={() => setSelected(null)}>
                ✖️ {t('Close', '关闭')}
              </Button>
            </div>
          </header>
          <div className="notes-content-body">
            <pre>{selected.content}</pre>
          </div>
        </div>
      ) : null}

      {/* Notes List */}
      <div className="notes-list-section">
        {loading ? (
          <p className="muted">{t('Loading notes…', '正在加载笔记…')}</p>
        ) : displayList.length === 0 ? (
          <div className="notes-empty-state">
            <p className="muted">
              {t(
                'No notes yet. Create one here, via chat with agent (note_write), or place .md files in ~/.piwin/notes/.',
                '暂无笔记。可点击上方「新建笔记」、在对话中让 Agent 记录，或直接将 .md 文件放入 ~/.piwin/notes/ 目录。',
              )}
            </p>
          </div>
        ) : (
          <ul className="notes-grid-list" data-testid="notes-list">
            {displayList.map((record, index) => {
              const hit = hits?.[index];
              return (
                <li key={record.id} className="notes-item-card">
                  <button
                    type="button"
                    className="notes-item-btn"
                    onClick={() => void handleOpen(record.id)}
                  >
                    <div className="notes-item-top">
                      <strong className="notes-item-title">{record.title}</strong>
                      <span className="notes-item-coll">📁 {record.collection || 'default'}</span>
                      {hit && (
                        <span className="doc-cards-channel-tag">
                          {hit.channels.join('+')}
                        </span>
                      )}
                    </div>
                    <p className="notes-item-preview">
                      {(hit?.snippet ?? record.content).slice(0, 140)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function NoteEditor(props: {
  initialTitle: string;
  initialContent: string;
  busy: boolean;
  isZh: boolean;
  onSave: (input: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.initialTitle);
  const [content, setContent] = useState(props.initialContent);
  const isZh = props.isZh;

  return (
    <div className="notes-editor-card" data-testid="notes-editor">
      <h4>{props.initialTitle ? (isZh ? '编辑笔记' : 'Edit Note') : (isZh ? '新建笔记' : 'New Note')}</h4>
      <div className="notes-editor-title-wrap">
        <TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={isZh ? '笔记标题…' : 'Title…'}
          data-testid="notes-editor-title"
        />
      </div>
      <div className="notes-editor-content-wrap">
        <TextArea
          value={content}
          onChange={(val) => setContent(val)}
          placeholder={isZh ? '输入 Markdown 格式内容…' : 'Markdown content…'}
          data-testid="notes-editor-content"
          rows={12}
        />
      </div>
      <div className="notes-editor-actions">
        <Button
          variant="primary"
          disabled={props.busy || !title.trim() || !content.trim()}
          data-testid="notes-editor-save"
          onClick={() => props.onSave({ title: title.trim(), content })}
        >
          💾 {isZh ? '保存笔记' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {isZh ? '取消' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}
