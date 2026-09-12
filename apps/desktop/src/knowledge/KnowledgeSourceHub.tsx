import { useMemo, useState, type ReactElement } from 'react';
import { Button, ConfirmDialog, IconButton, Notice, TextInput } from '@piwin/ui-kit';
import type { KnowledgeBaseSummary, KnowledgeCitation, KnowledgeSearchResult } from '@piwin/contracts';
import { IconEdit, IconTrash } from '../shell-icons.js';
import { isSearchableKnowledgeBase } from './knowledge-base-client.js';
import { knowledgeStateCopy, type KnowledgeLocale } from './knowledge-base-copy.js';
import { KnowledgeChunkInspector } from './KnowledgeChunkInspector.js';
import { KnowledgeSearchPanel } from './KnowledgeSearchPanel.js';
import type { KnowledgeActionResult } from './use-knowledge-bases.js';

export type KnowledgeSourceHubProps = {
  bases: readonly KnowledgeBaseSummary[];
  selectedId: string | null;
  onSelectBase: (id: string) => void;
  locale: KnowledgeLocale;
  onAddFolder: () => void;
  onOpenIngest: (folderPath: string) => void;
  onProduceFlashcards: (folderPath: string) => void;
  onUseInChat: (baseId: string) => void;
  onSendToChat: (text: string) => void;
  onConfigureEmbedding?: (() => void) | undefined;
  onRename: (baseId: string, name: string) => Promise<KnowledgeActionResult<KnowledgeBaseSummary>>;
  onRemove: (baseId: string, deleteIndex: boolean) => Promise<KnowledgeActionResult<null>>;
  search: (
    query: string,
    baseIds?: readonly string[],
  ) => Promise<KnowledgeActionResult<KnowledgeSearchResult>>;
  onOpenCitation: (citation: KnowledgeCitation) => void;
  testId?: string | undefined;
};

export function KnowledgeSourceHub(props: KnowledgeSourceHubProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  const [filterQuery, setFilterQuery] = useState('');

  const filteredBases = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return props.bases;
    return props.bases.filter(
      (b) => b.name.toLowerCase().includes(q) || (b.folderPath?.toLowerCase().includes(q) ?? false),
    );
  }, [props.bases, filterQuery]);

  const folderBases = useMemo(
    () => filteredBases.filter((b) => b.kind === 'folder'),
    [filteredBases],
  );
  const noteBases = useMemo(
    () => filteredBases.filter((b) => b.kind === 'notes'),
    [filteredBases],
  );
  const activeBase = useMemo(() => {
    return props.bases.find((b) => b.id === props.selectedId) ?? props.bases[0] ?? null;
  }, [props.bases, props.selectedId]);

  const activeCopy = activeBase ? knowledgeStateCopy(activeBase, props.locale) : null;

  // Rename & remove dialog states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const targetDeleteBase = useMemo(
    () => props.bases.find((b) => b.id === confirmDeleteId) ?? null,
    [props.bases, confirmDeleteId],
  );

  async function handleCommitRename(baseId: string): Promise<void> {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    const res = await props.onRename(baseId, trimmed);
    if (res.ok) {
      setEditingId(null);
      setRenameError(null);
    } else {
      setRenameError(res.error);
    }
  }

  async function handleConfirmRemove(deleteIndex: boolean): Promise<void> {
    if (!confirmDeleteId) return;
    setDeleting(true);
    const res = await props.onRemove(confirmDeleteId, deleteIndex);
    setDeleting(false);
    if (res.ok) {
      setConfirmDeleteId(null);
      setDeleteError(null);
    } else {
      setDeleteError(res.error);
    }
  }

  return (
    <div className="source-layout" data-testid={props.testId ?? 'knowledge-source-hub'}>
      {/* Left Column: Source Navigator Sidebar */}
      <aside className="source-sidebar" aria-label={t('Sources Navigator', '信源导航')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ font: '600 13px var(--serif, serif)', color: 'var(--text-1)' }}>
            {t('Sources & Raw Materials', '信源与原始素材')}
          </span>
          <button
            type="button"
            className="btn sm pri"
            onClick={props.onAddFolder}
            data-testid="knowledge-add-folder"
          >
            {t('Add Source', '新增信源')}
          </button>
        </div>

        <div className="source-search-box">
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.currentTarget.value)}
            placeholder={t('Filter sources or tags…', '过滤信源或标签…')}
          />
        </div>

        {noteBases.length > 0 && (
          <>
            <div className="source-group-title">{t('Built-in Notes', '系统内置素材')}</div>
            {noteBases.map((b) => (
              <div
                key={b.id}
                id={`src-item-${b.id}`}
                className={`source-item kb-list-row${b.id === activeBase?.id ? ' active' : ''}`}
                onClick={() => props.onSelectBase(b.id)}
                data-testid={`knowledge-base-row-${b.id}`}
              >
                <div className="source-item-meta">
                  <span className="source-item-name">{b.name}</span>
                  <span className="source-item-sub">
                    ~/.piwin/notes · {b.documentCount ?? 0} {t('notes', '条便签')}
                  </span>
                </div>
                <span className="stamp-pill lamp">{t('Notes', '便签')}</span>
              </div>
            ))}
          </>
        )}

        {folderBases.length > 0 && (
          <>
            <div className="source-group-title">{t('Local Repos & Folders', '本地代码与文档工程')}</div>
            {folderBases.map((b) => (
              <div
                key={b.id}
                id={`src-item-${b.id}`}
                className={`source-item kb-list-row${b.id === activeBase?.id ? ' active' : ''}`}
                onClick={() => props.onSelectBase(b.id)}
                data-testid={`knowledge-base-row-${b.id}`}
              >
                <div className="source-item-meta">
                  <span className="source-item-name">{b.name}</span>
                  <span className="source-item-sub">
                    {b.folderPath} · {b.documentCount ?? 0} {t('files', '文件')}
                  </span>
                </div>
                <span className="stamp-pill">
                  {b.documentCount ?? 0} {t('files', '文件')}
                </span>
              </div>
            ))}
          </>
        )}

        <div
          style={{
            marginTop: 'auto',
            paddingTop: '12px',
            borderTop: '1px dashed var(--line-1)',
            fontSize: '11px',
            color: 'var(--text-4)',
            lineHeight: 1.5,
          }}
        >
          {t(
            'Supports importing local repos, Markdown, and PDFs from chat, clipboard, or disk.',
            '支持从对话、剪贴板、本地磁盘导入代码库、Markdown 与 PDF。',
          )}
        </div>
      </aside>

      {/* Right Column: Selected Source Workbench */}
      <main
        className="source-workbench"
        data-testid={activeBase ? 'knowledge-base-detail' : undefined}
        aria-label={t('Source Detail Workbench', '信源详情工作台')}
      >
        {activeBase && activeCopy ? (
          <>
            <div className="workbench-header">
              <div>
                {editingId === activeBase.id ? (
                  <div className="kb-detail-rename">
                    <TextInput
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Enter') void handleCommitRename(activeBase.id);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      testId="knowledge-base-rename-input"
                    />
                    <Button variant="primary" size="compact" onClick={() => void handleCommitRename(activeBase.id)}>
                      <span>{t('Save', '保存')}</span>
                    </Button>
                    <Button variant="ghost" size="compact" onClick={() => setEditingId(null)}>
                      <span>{t('Cancel', '取消')}</span>
                    </Button>
                  </div>
                ) : (
                  <h2 id="wb-title">
                    <span>{activeBase.name}</span>
                    <span
                      className={`stamp-pill ${activeBase.state === 'ready' ? '' : 'ochre'}`}
                      id="wb-badge"
                      data-testid="knowledge-base-state"
                    >
                      {activeCopy.label}
                    </span>
                  </h2>
                )}
                {renameError ? <span className="kb-detail-error" role="alert">{renameError}</span> : null}
                <div className="workbench-path" id="wb-path">
                  {activeBase.folderPath ?? '~/.piwin/notes'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {activeBase.kind === 'folder' ? (
                  <IconButton
                    label={t('Rename', '重命名')}
                    onClick={() => {
                      setNameDraft(activeBase.name);
                      setRenameError(null);
                      setEditingId(activeBase.id);
                    }}
                    data-testid="knowledge-base-rename"
                  >
                    <IconEdit width={14} height={14} />
                  </IconButton>
                ) : null}
                {activeBase.kind === 'folder' ? (
                  <IconButton
                    label={t('Remove knowledge base', '移除知识库')}
                    onClick={() => setConfirmDeleteId(activeBase.id)}
                    data-testid="knowledge-base-remove"
                  >
                    <IconTrash width={14} height={14} />
                  </IconButton>
                ) : null}
                {isSearchableKnowledgeBase(activeBase) ? (
                  <button
                    type="button"
                    className="btn sec"
                    onClick={() => props.onUseInChat(activeBase.id)}
                    data-testid="knowledge-base-use-in-chat"
                  >
                    {t('Use in chat', '在对话中使用')}
                  </button>
                ) : null}
                {isSearchableKnowledgeBase(activeBase) && activeBase.folderPath ? (
                  <button
                    type="button"
                    className="btn sec"
                    onClick={() => props.onOpenIngest(activeBase.folderPath!)}
                    data-testid="knowledge-base-reslice"
                  >
                    {t('Re-slice', '重新切片')}
                  </button>
                ) : null}
                {activeBase.folderPath && props.onProduceFlashcards ? (
                  <button
                    type="button"
                    className="btn pri"
                    onClick={() => props.onProduceFlashcards(activeBase.folderPath!)}
                    data-testid="knowledge-produce-cards-btn"
                  >
                    {t('Distill to Wiki & Flashcards', '提炼为维基与闪卡')}
                  </button>
                ) : null}
                {!isSearchableKnowledgeBase(activeBase) && activeBase.folderPath ? (
                  <button
                    type="button"
                    className="btn pri"
                    onClick={() => props.onOpenIngest(activeBase.folderPath!)}
                    data-testid="knowledge-base-open-ingest"
                  >
                    {t('Select files to ingest', '选择文件入库')}
                  </button>
                ) : null}
              </div>
            </div>

            {activeBase.degraded && isSearchableKnowledgeBase(activeBase) ? (
              <div data-testid="knowledge-base-degraded" className="kb-card-notice-row">
                <Notice tone="warning">
                  {t(
                    'No embedding model configured; search is running in full-text mode.',
                    '未配置向量模型，目前只用全文检索。',
                  )}
                </Notice>
              </div>
            ) : null}

            <div className="workbench-stats">
              <div className="w-stat">
                <span className="num" id="wb-file-count">{activeBase.documentCount ?? 0}</span>
                <span className="lbl">{t('Scanned Files', '扫描源文件数')}</span>
              </div>
              <div className="w-stat">
                <span className="num" id="wb-chunk-count">{activeBase.chunkCount ?? 0}</span>
                <span className="lbl">{t('Chunks', '向量切片 Chunks')}</span>
              </div>
              <div className="w-stat">
                <span className="num">0.87s</span>
                <span className="lbl">{t('Avg Latency', '平均切片检出延迟')}</span>
              </div>
              <div className="w-stat">
                <span className="num" style={{ color: 'var(--pine, #3d7c5e)' }}>
                  {activeBase.state === 'ready'
                    ? (activeBase.degraded ? t('Full-text mode', '包含全文') : '100%')
                    : t('Unindexed', '未入库')}
                </span>
                <span className="lbl">{t('Index Health', '索引健康状态')}</span>
              </div>
            </div>

            {isSearchableKnowledgeBase(activeBase) ? (
              <div style={{ background: 'var(--surface-1, var(--s2))', border: '1px solid var(--line-1, var(--l1))', borderRadius: '5px', padding: '10px 12px' }}>
                <KnowledgeSearchPanel
                  base={activeBase}
                  searchable={true}
                  locale={props.locale}
                  search={props.search}
                  onOpenCitation={props.onOpenCitation}
                  onSendToChat={props.onSendToChat}
                />
              </div>
            ) : null}

            <KnowledgeChunkInspector
              base={activeBase}
              locale={props.locale}
              onSendToChat={props.onSendToChat}
              onProduceFlashcards={props.onProduceFlashcards}
            />
          </>
        ) : (
          <div className="vault-empty">
            <p>{t('Select a source from the left list', '从左侧选择信源库查看详情')}</p>
          </div>
        )}
      </main>

      {/* Remove Confirmation Dialog */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteId(null);
            setDeleteError(null);
          }
        }}
        title={t('Remove this knowledge base?', '移除这个知识库？')}
        description={t(
          'Files in the folder are not touched. Keep the index to re-add it later without re-ingesting.',
          '文件夹里的文件不会被改动。保留索引的话，之后重新添加无需再次入库。',
        )}
        affectedObject={targetDeleteBase?.name ?? ''}
        confirmLabel={t('Remove, keep index', '移除，保留索引')}
        alternateLabel={t('Remove and delete index', '移除并删除索引')}
        onAlternate={() => void handleConfirmRemove(true)}
        cancelLabel={t('Cancel', '取消')}
        tone="danger"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void handleConfirmRemove(false)}
        testId="knowledge-base-remove-dialog"
      />
    </div>
  );
}
