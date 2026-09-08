import { useState, type ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem, EmptyState, FileTypeIcon, IconButton } from '@piwin/ui-kit';
import {
  IconBook,
  IconChat,
  IconCopy,
  IconDocument,
  IconDownload,
  IconClose,
  IconLink,
  IconMenuList,
  IconMore,
} from './shell-icons';
import { EnhancedMarkdownView, type LineCommentItem } from './EnhancedMarkdownView';
import { CodePreviewView } from './code-preview-view';
import type { DesktopLocale } from './desktop-locale';
import type { DocumentProvenance } from './active-document';
import type { ArtifactThemeVariables } from '@piwin/artifact';
import { MarkupPreviewView, markupPreviewKind } from './markup-preview-view';
import { PreviewUnavailable } from './PreviewUnavailable';
import {
  isOpaqueRemoteProjectId,
  remoteProjectFilesystemRoot,
} from './remote-session-hydrate.js';

/** Markdown / plaintext files render through the enhanced Markdown viewer.
 *  HTML/SVG render visually. Everything else renders as code with line numbers. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt', 'text']);

function isMarkdownPath(path: string): boolean {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
  const ext = extMatch && extMatch[1] ? extMatch[1].toLowerCase() : '';
  return ext === '' || MARKDOWN_EXTENSIONS.has(ext);
}

/** Expand `project-<hash>/rel` to a Host absolute path when the root is known. */
export function resolveCopiedDocumentPath(rawPath: string): string {
  const raw = rawPath.trim();
  if (!raw) return raw;
  const normalized = raw.replace(/\\/g, '/');
  const slash = normalized.indexOf('/');
  if (slash <= 0) return raw;
  const head = normalized.slice(0, slash);
  const rest = normalized.slice(slash + 1);
  if (!isOpaqueRemoteProjectId(head) || !rest) return raw;
  const root = remoteProjectFilesystemRoot(head);
  return root ? `${root}/${rest}` : raw;
}

export type SessionDocItem = {
  id: string;
  title: string;
  path?: string | undefined;
  iconKind?: 'doc' | 'book' | 'plan' | undefined;
};

export type DocPreviewPanelProps = {
  title?: string | undefined;
  content?: string | undefined;
  filePath?: string | null | undefined;
  /** loading | ready | unavailable — when omitted, treat as ready with content. */
  status?: 'loading' | 'ready' | 'unavailable' | undefined;
  displayRef?: string | undefined;
  provenance?: DocumentProvenance | undefined;
  warning?: string | undefined;
  skillId?: string | undefined;
  skillSource?: string | undefined;
  unavailableReason?: string | undefined;
  suggestion?: string | undefined;
  byteSize?: number | undefined;
  maxBytes?: number | undefined;
  /** Trusted-domain preview badge (ADR 0052 Slice 3). */
  readOnly?: boolean | undefined;
  sessionDocuments?: SessionDocItem[] | undefined;
  onSelectDocument?: ((doc: { title: string; path?: string }) => void) | undefined;
  onClose?: (() => void) | undefined;
  onOpenFile?: ((filePath: string) => void) | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
  locale?: DesktopLocale | undefined;
  artifactTheme?: ArtifactThemeVariables | undefined;
};

export function DocPreviewPanel({
  title = 'Implementation Plan',
  content = '',
  filePath = null,
  status = 'ready',
  displayRef,
  provenance,
  warning,
  skillId,
  skillSource,
  unavailableReason,
  byteSize,
  maxBytes,
  readOnly = false,
  sessionDocuments,
  onSelectDocument,
  onClose,
  onOpenFile,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
  locale = 'zh-CN',
  artifactTheme,
}: DocPreviewPanelProps): ReactElement {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const rawTitle = title || 'Implementation Plan';
  const cleanName = rawTitle.split(/[\\/]/).pop() || rawTitle;
  const displayTitle = cleanName.replace(/\.md$/i, '');
  const defaultContent =
    content ||
    `# ${displayTitle}\n\n*${locale === 'zh-CN' ? '暂无文档内容' : 'No document content available'}*`;

  const targetPath = filePath || (title && title.includes('.') ? title : `${displayTitle}.md`);
  const tooltipPath = displayRef || filePath || rawTitle;
  const commentCount = comments.length;
  const markupKind = markupPreviewKind(targetPath);
  const showSkillChip = Boolean(skillId);
  const showReadOnlyChip = readOnly || provenance === 'trusted-config';
  const showLoadingChip = status === 'loading';
  const showCommentBadge = commentCount > 0;
  const showMeta = showSkillChip || showReadOnlyChip || showLoadingChip || showCommentBadge;

  const canCopyExport = status === 'ready' && Boolean(content);

  function handleCopy(): void {
    if (!canCopyExport || !content) return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        /* ignore */
      }
    })();
  }

  function handleCopyPath(): void {
    const pathText = resolveCopiedDocumentPath(filePath || `${displayTitle}.md`);
    void (async () => {
      try {
        await navigator.clipboard.writeText(pathText);
      } catch {
        /* ignore */
      }
    })();
  }

  function handleExportArtifact(): void {
    if (!canCopyExport || !content) return;
    try {
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${displayTitle}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="doc-preview-panel" data-testid="doc-preview-panel">
      <header className="doc-preview-header doc-h">
        <div className="doc-preview-title-group">
          <FileTypeIcon filePathOrExt={targetPath} />
          <h2 className="doc-preview-title" title={tooltipPath}>
            {displayTitle}
          </h2>
          {showMeta ? (
            <div className="doc-preview-meta" data-testid="doc-preview-meta">
              {showSkillChip ? (
                <span className="doc-preview-chip" data-testid="doc-preview-skill-id">
                  Skill · {skillId}
                  {skillSource ? ` · ${skillSource}` : ''}
                </span>
              ) : null}
              {showReadOnlyChip ? (
                <span className="doc-preview-chip" data-testid="doc-preview-readonly">
                  {locale === 'zh-CN' ? '项目外 · 只读' : 'Outside project · read-only'}
                </span>
              ) : null}
              {showLoadingChip ? (
                <span className="doc-preview-chip" data-testid="doc-preview-loading">
                  {locale === 'zh-CN' ? '加载中…' : 'Loading…'}
                </span>
              ) : null}
              {showCommentBadge ? (
                <span className="doc-comment-badge">
                  · {commentCount}
                  <IconChat width={12} height={12} />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="doc-preview-actions">
          {onClose ? (
            <IconButton
              label={locale === 'zh-CN' ? '返回会话' : 'Back to conversation'}
              title={locale === 'zh-CN' ? '返回会话' : 'Back to conversation'}
              data-testid="doc-preview-close"
              onClick={onClose}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          ) : null}
          <DropdownMenu
            trigger={
              <IconButton label={locale === 'zh-CN' ? '更多选项' : 'More options'}>
                <IconMore width={14} height={14} />
              </IconButton>
            }
          >
            <DropdownMenuItem onSelect={handleCopy} testId="doc-menu-copy">
              <span className="doc-menu-item-content">
                <IconCopy width={14} height={14} /> Copy
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleCopyPath} testId="doc-menu-copy-path">
              <span className="doc-menu-item-content">
                <IconLink width={14} height={14} /> Copy Path
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleExportArtifact} testId="doc-menu-export">
              <span className="doc-menu-item-content">
                <IconDownload width={14} height={14} /> Export Artifact
              </span>
            </DropdownMenuItem>
          </DropdownMenu>

          <IconButton
            label={locale === 'zh-CN' ? '切换侧边栏' : 'Toggle Sidebar'}
            title={locale === 'zh-CN' ? '切换侧边栏' : 'Toggle Sidebar'}
            onClick={() => setSidebarOpen((prev) => !prev)}
            className={sidebarOpen ? 'doc-action-active' : ''}
          >
            <IconMenuList width={14} height={14} />
          </IconButton>
        </div>
      </header>

      <div className="doc-preview-container">
        {sidebarOpen && sessionDocuments && sessionDocuments.length > 0 ? (
          <aside className="doc-sidebar" data-testid="doc-sidebar">
            <div className="doc-sidebar-header">
              <span>Artifacts</span>
            </div>
            <ul className="doc-sidebar-list">
              {sessionDocuments.map((docItem) => {
                const isActive =
                  docItem.title.toLowerCase() === displayTitle.toLowerCase() ||
                  (docItem.path && filePath && docItem.path.includes(filePath));
                const itemPath = docItem.path || docItem.title;
                return (
                  <li key={docItem.id}>
                    <button
                      type="button"
                      className={`doc-sidebar-item${isActive ? ' active' : ''}`}
                      onClick={() =>
                        onSelectDocument?.({
                          title: docItem.title,
                          ...(docItem.path ? { path: docItem.path } : {}),
                        })
                      }
                    >
                      <span className="doc-sidebar-icon">
                        {docItem.iconKind === 'book' ? (
                          <IconBook width={14} height={14} />
                        ) : docItem.iconKind === 'plan' ? (
                          <IconDocument width={14} height={14} />
                        ) : (
                          <FileTypeIcon filePathOrExt={itemPath} />
                        )}
                      </span>
                      <span className="doc-sidebar-title">{docItem.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        ) : null}

        <div className="doc-preview-body">
          {status === 'loading' ? (
            <div className="preview-unavailable" data-testid="doc-preview-state-loading">
              <EmptyState
                title={locale === 'zh-CN' ? '正在加载预览…' : 'Loading preview…'}
              />
            </div>
          ) : status === 'unavailable' ? (
            <PreviewUnavailable
              reason={unavailableReason || 'unavailable'}
              locale={locale}
              fileName={targetPath}
              {...(byteSize !== undefined ? { byteSize } : {})}
              {...(maxBytes !== undefined ? { maxBytes } : {})}
              testId="doc-preview-state-unavailable"
            />
          ) : (
            <>
              {warning ? (
                <div className="doc-preview-warning" data-testid="doc-preview-warning">
                  {warning}
                </div>
              ) : null}
              {markupKind ? (
                <MarkupPreviewView
                  source={defaultContent}
                  kind={markupKind}
                  locale={locale}
                  {...(artifactTheme ? { theme: artifactTheme } : {})}
                />
              ) : isMarkdownPath(targetPath) ? (
                <EnhancedMarkdownView
                  text={defaultContent}
                  docTitle={displayTitle}
                  filePath={targetPath}
                  onOpenFile={onOpenFile}
                  comments={comments}
                  onAddComment={onAddComment}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
                  onCommentLine={onCommentLine}
                />
              ) : (
                <CodePreviewView code={defaultContent} filePath={targetPath} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
