/**
 * View A: Repo Wiki & RAG Hybrid Search.
 * Displays project documentation, architecture overview, and instant RAG retrieval.
 */

import { useState, type ReactElement } from 'react';
import { Button, IconButton, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import type { HostResponse, NoteRecord } from '@piwin/contracts';
import { copyToClipboard, downloadFile } from '../knowledge-export.js';
import {
  IconCommentAction,
  IconCopy,
  IconDocument,
  IconDownload,
  IconSearch,
} from '../shell-icons.js';

export type WikiSearchHit = {
  chunkId: string;
  relativePath: string;
  content: string;
  score: number;
  startLine?: number | undefined;
};

export type KnowledgeWikiViewProps = {
  folderPath: string;
  folderName: string;
  notes: NoteRecord[];
  request: (command: any) => Promise<HostResponse>;
  onSendToChat?: ((text: string) => void) | undefined;
  onOpenSourceFile?: ((filePath: string) => void) | undefined;
  isEmbeddingConfigured?: boolean | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
};

export function KnowledgeWikiView(props: KnowledgeWikiViewProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<WikiSearchHit[] | null>(null);
  const selectedNote = props.notes[0] ?? null;
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function handleSearch(): Promise<void> {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const response = await props.request({
        type: 'doccards/retrieve',
        folderPath: props.folderPath,
        query: q,
        limit: 15,
      });
      if (response.success && response.data) {
        const data = response.data as {
          chunks?: Array<{
            chunkId?: string;
            filePath?: string;
            relativePath?: string;
            content?: string;
            score?: number;
            startLine?: number;
          }>;
          hits?: Array<{
            chunkId?: string;
            filePath?: string;
            relativePath?: string;
            content?: string;
            score?: number;
            startLine?: number;
          }>;
          degraded?: boolean;
        };
        const rawHits = data.chunks ?? data.hits ?? [];
        setHits(
          rawHits.map((hit, index) => {
            const path = hit.filePath ?? hit.relativePath ?? '';
            const startLine = hit.startLine;
            return {
              chunkId: `${path}:${startLine ?? index}`,
              relativePath:
                typeof startLine === 'number' && path.length > 0 ? `${path}:${startLine}` : path,
              content: hit.content ?? '',
              score: typeof hit.score === 'number' ? hit.score : 0,
              startLine,
            };
          }),
        );
        setDegraded(data.degraded === true);
      } else {
        setHits([]);
        setSearchError(
          response.success === false
            ? response.error
            : t('Search failed', '检索失败'),
        );
      }
    } finally {
      setSearching(false);
    }
  }

  function handleSendPromptToChat(): void {
    if (!props.onSendToChat) return;
    const prompt = isZh
      ? `请围绕项目「${props.folderName}」的知识库与架构设计，深入讲解以下内容：`
      : `Please explain the following architectural design for project "${props.folderName}":`;
    props.onSendToChat(prompt);
  }

  function handleCopyNote(): void {
    const text = selectedNote
      ? `# ${selectedNote.title}\n\n${selectedNote.content}`
      : hits
        ? hits.map((h) => `### ${h.relativePath}\n\n${h.content}`).join('\n\n---\n\n')
        : '';
    if (!text) return;
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleExportMarkdown(): void {
    const text = selectedNote
      ? `# ${selectedNote.title}\n\n${selectedNote.content}`
      : `# ${props.folderName} Wiki\n\n${props.notes.map((n) => `## ${n.title}\n\n${n.content}`).join('\n\n---\n\n')}`;
    downloadFile(`${props.folderName}-wiki.md`, text, 'text/markdown');
  }

  return (
    <div className="knowledge-wiki-view" data-testid="knowledge-wiki-view">
      {/* Top Search & Actions Bar */}
      <div className="wiki-view-header">
        <div className="wiki-search-box">
          <div className="wiki-search-icon-wrap">
            <IconSearch width={14} height={14} />
          </div>
          <TextInput
            placeholder={t(
              'Ask or search repository knowledge (RAG hybrid)...',
              '自然语言检索或提问项目知识库 (RAG 混合检索)...',
            )}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch();
            }}
            className="wiki-search-input"
            testId="wiki-search-input"
          />
          <div className="wiki-search-key-badge">Enter ↵</div>
          <Button
            size="compact"
            variant="secondary"
            onClick={() => void handleSearch()}
            disabled={searching}
            data-testid="wiki-search-btn"
            className="wiki-search-action-btn"
          >
            <span>{searching ? t('Searching...', '检索中...') : t('Search', '检索')}</span>
          </Button>
        </div>

        <div className="wiki-actions">
          {props.onSendToChat ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={handleSendPromptToChat}
              title={t('Discuss in chat', '在对话中研讨')}
              data-testid="wiki-send-to-chat-btn"
              className="wiki-discuss-btn"
            >
              <IconCommentAction width={13} height={13} />
              <span>{t('Discuss in Chat', '在对话中研讨')}</span>
            </Button>
          ) : null}
          <IconButton
            label={copied ? t('Copied!', '已复制') : t('Copy Markdown', '复制 Markdown')}
            onClick={handleCopyNote}
            data-testid="wiki-copy-btn"
          >
            <IconCopy width={14} height={14} />
          </IconButton>
          <IconButton
            label={t('Export as Markdown', '导出为 .MD')}
            onClick={handleExportMarkdown}
            data-testid="wiki-export-btn"
          >
            <IconDownload width={14} height={14} />
          </IconButton>
        </div>
      </div>

      {/* Main Documentation Stage */}
      <div className="wiki-view-body">
        {hits ? (
          <div className="wiki-search-results">
            <div className="search-results-header">
              <span className="results-count">
                {t(`Found ${hits.length} retrieved slices:`, `检索到 ${hits.length} 个相关切片：`)}
              </span>
              {degraded ? (
                <div className="wiki-degraded-prompt" data-testid="wiki-search-degraded">
                  <span className="degraded-dot" />
                  <span>{t('FTS-only (no embeddings)', '仅全文检索（未配置向量）')}</span>
                  {props.onConfigureEmbedding ? (
                    <button
                      type="button"
                      className="degraded-config-link"
                      onClick={props.onConfigureEmbedding}
                      data-testid="wiki-degraded-config-link"
                    >
                      {t('Configure →', '去配置 →')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <Button size="compact" variant="ghost" onClick={() => setHits(null)}>
                {t('Clear search', '清除检索')}
              </Button>
            </div>
            {searchError ? (
              <p className="muted" role="alert" data-testid="wiki-search-error">
                {searchError}
              </p>
            ) : null}
            {hits.length === 0 && !searchError ? (
              <p className="muted" data-testid="wiki-search-empty">
                {t('No matching passages in this folder.', '这个文件夹还没有检索结果。')}
              </p>
            ) : null}
            <div className="search-hits-list">
              {hits.map((hit) => (
                <div key={hit.chunkId} className="search-hit-card">
                  <div className="hit-card-title">
                    <div className="hit-file-info">
                      <IconDocument width={14} height={14} />
                      <span className="hit-filename">{hit.relativePath}</span>
                    </div>
                    <span className="hit-score-badge">Score {(hit.score * 100).toFixed(0)}%</span>
                  </div>
                  <pre className="hit-snippet">{hit.content}</pre>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="wiki-document-container">
            {props.notes.length === 0 ? (
              <div className="wiki-empty-notice">
                <div className="wiki-empty-hero">
                  <div className="wiki-hero-icon-bubble">
                    <IconDocument width={28} height={28} />
                  </div>
                  <h3>{t('Search this folder', '搜索此文件夹')}</h3>
                  <p className="muted">
                    {t(
                      'No matching passages in this folder.',
                      '这个文件夹还没有检索结果。',
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <article className="wiki-markdown-article">
                {selectedNote ? (
                  <>
                    <h1 className="wiki-article-title">{selectedNote.title}</h1>
                    <div className="wiki-article-content">
                      <pre className="wiki-raw-content">{selectedNote.content}</pre>
                    </div>
                  </>
                ) : null}
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
