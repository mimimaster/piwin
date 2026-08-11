/**
 * Turn-level "N files changed" bar under an assistant reply.
 * Lists files mutated by tools on that message; Review opens the Changes panel.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { GitDiffSummary, HostResponse } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import {
  collectMessageChangedFiles,
  deriveFallbackStatsForTools,
  matchChangedFileStats,
  type MessageChangedFile,
  type MessageChangedFileStat,
} from './collect-message-changed-files';
import { IconChevronDown, IconFile, IconFileDiff, IconMore } from './shell-icons';

export type FilesChangedBarRequest = (command: {
  type: 'git/diff-summary';
  projectPath: string;
}) => Promise<HostResponse>;

/** Session-open can mount many FilesChangedBar rows; share one in-flight/result per project. */
const GIT_DIFF_SUMMARY_CACHE_TTL_MS = 15_000;
const gitDiffSummaryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<HostResponse> }
>();

const DEFAULT_MAX_VISIBLE_ROWS = 5;

function requestGitDiffSummaryCached(
  request: FilesChangedBarRequest,
  projectPath: string,
): Promise<HostResponse> {
  const now = Date.now();
  const cached = gitDiffSummaryCache.get(projectPath);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }
  const promise = request({ type: 'git/diff-summary', projectPath }).then(
    (response) => {
      // Keep successful summaries briefly; do not cache hard failures forever.
      if (!response.success) {
        gitDiffSummaryCache.delete(projectPath);
      }
      return response;
    },
    (error: unknown) => {
      gitDiffSummaryCache.delete(projectPath);
      throw error;
    },
  );
  gitDiffSummaryCache.set(projectPath, {
    expiresAt: now + GIT_DIFF_SUMMARY_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

export type FilesChangedBarProps = {
  tools: ToolCardUi[];
  /** When false, hide the bar even if tools have paths (e.g. still streaming with no writes). */
  visible?: boolean;
  projectPath?: string | null;
  request?: FilesChangedBarRequest;
  /** Open the Review / Changes inspector tab. */
  onReview?: () => void;
  locale?: 'zh-CN' | 'en';
};

export type DisplayPathParts = {
  fileName: string;
  dirPath: string;
  fullDisplayPath: string;
};

export function getRelativeFilePath(fullPath: string, projectPath?: string | null): string {
  if (!fullPath) return '';
  const normPath = fullPath.replace(/\\/g, '/');
  if (!projectPath) {
    return normPath;
  }
  const normProj = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normPath === normProj) {
    return '.';
  }
  if (normPath.startsWith(normProj + '/')) {
    return normPath.slice(normProj.length + 1);
  }
  return normPath;
}

export function formatDisplayPathParts(
  fullPath: string,
  projectPath?: string | null,
): DisplayPathParts {
  const relPath = getRelativeFilePath(fullPath, projectPath);
  const parts = relPath.split('/');
  const fileName = parts[parts.length - 1] || relPath;
  const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
  return {
    fileName,
    dirPath,
    fullDisplayPath: relPath,
  };
}

function formatCountLabel(count: number, isZh: boolean): string {
  if (isZh) {
    return count === 1 ? '1 个文件已更改' : `${count} 个文件已更改`;
  }
  return count === 1 ? '1 File Changed' : `${count} files changed`;
}

export function FileExtBadge({ path }: { path: string }): ReactElement {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'tsx' || ext === 'jsx') {
    return (
      <span className="file-ext-badge ext-react" title={ext.toUpperCase()}>
        <svg viewBox="0 0 100 100" width="13" height="13" fill="currentColor">
          <circle cx="50" cy="50" r="10" />
          <ellipse
            cx="50"
            cy="50"
            rx="40"
            ry="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
          />
          <ellipse
            cx="50"
            cy="50"
            rx="40"
            ry="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            transform="rotate(60 50 50)"
          />
          <ellipse
            cx="50"
            cy="50"
            rx="40"
            ry="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            transform="rotate(120 50 50)"
          />
        </svg>
      </span>
    );
  }
  if (ext === 'ts') {
    return <span className="file-ext-badge ext-ts">TS</span>;
  }
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return <span className="file-ext-badge ext-js">JS</span>;
  }
  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return <span className="file-ext-badge ext-css">{`{ }`}</span>;
  }
  if (ext === 'json') {
    return <span className="file-ext-badge ext-json">{`{ }`}</span>;
  }
  if (ext === 'md') {
    return <span className="file-ext-badge ext-md">MD</span>;
  }
  if (ext === 'py') {
    return <span className="file-ext-badge ext-py">PY</span>;
  }
  if (ext === 'rs') {
    return <span className="file-ext-badge ext-rs">RS</span>;
  }
  if (ext === 'svg') {
    return <span className="file-ext-badge ext-svg">SVG</span>;
  }
  if (ext === 'html' || ext === 'htm') {
    return <span className="file-ext-badge ext-html">HTML</span>;
  }
  if (ext === 'sh' || ext === 'zsh' || ext === 'bash') {
    return <span className="file-ext-badge ext-sh">SH</span>;
  }
  if (ext === 'yaml' || ext === 'yml') {
    return <span className="file-ext-badge ext-yaml">YML</span>;
  }
  if (ext.length >= 1 && ext.length <= 4) {
    return <span className="file-ext-badge ext-generic">{ext.toUpperCase()}</span>;
  }

  return <IconFile className="files-changed-bar-row-icon" />;
}

export function FilesChangedBar(props: FilesChangedBarProps): ReactElement | null {
  const isZh = props.locale === 'zh-CN';
  const files = useMemo(() => collectMessageChangedFiles(props.tools), [props.tools]);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [stats, setStats] = useState<{
    additions: number;
    deletions: number;
    byPath?: Record<string, MessageChangedFileStat>;
  } | null>(null);

  const pathsKey = files.map((f) => f.path).join('\0');

  useEffect(() => {
    if (files.length === 0) {
      setStats(null);
      return;
    }
    if (!props.projectPath || !props.request) {
      setStats(deriveFallbackStatsForTools(props.tools, files));
      return;
    }
    let cancelled = false;
    const projectPath = props.projectPath;
    const request = props.request;
    void requestGitDiffSummaryCached(request, projectPath)
      .then((response) => {
        if (cancelled) return;
        const gitMatched = response.success
          ? matchChangedFileStats(files, (response.data as { summary: GitDiffSummary }).summary.files)
          : null;
        const finalStats = deriveFallbackStatsForTools(props.tools, files, gitMatched);
        setStats({
          additions: finalStats.additions,
          deletions: finalStats.deletions,
          byPath: finalStats.byPath,
        });
      })
      .catch(() => {
        if (!cancelled) setStats(deriveFallbackStatsForTools(props.tools, files));
      });
    return () => {
      cancelled = true;
    };
    // files identity is derived from tools; pathsKey captures content.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathsKey is the stable content key
  }, [props.projectPath, props.request, pathsKey]);

  if (props.visible === false || files.length === 0) {
    return null;
  }

  const countLabel = formatCountLabel(files.length, isZh);
  const reviewLabel = isZh ? '审查' : 'Review';

  const visibleFiles =
    expanded && !showAll && files.length > DEFAULT_MAX_VISIBLE_ROWS
      ? files.slice(0, DEFAULT_MAX_VISIBLE_ROWS)
      : files;
  const hiddenCount = files.length - visibleFiles.length;

  return (
    <div className="files-changed-bar" data-testid="files-changed-bar">
      <div className="files-changed-bar-head">
        <button
          type="button"
          className="files-changed-bar-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          data-testid="files-changed-bar-toggle"
        >
          <span className="files-changed-bar-summary">
            <span className="files-changed-bar-count">{countLabel}</span>
            {stats ? (
              <span className="files-changed-bar-stat" data-testid="files-changed-bar-stat">
                <span className="add">+{stats.additions}</span>
                <span className="del">-{stats.deletions}</span>
              </span>
            ) : null}
            <IconChevronDown
              className={expanded ? 'files-changed-bar-chevron open' : 'files-changed-bar-chevron'}
            />
          </span>
        </button>
        {props.onReview ? (
          <button
            type="button"
            className="files-changed-bar-review"
            onClick={props.onReview}
            data-testid="files-changed-bar-review"
          >
            <IconFileDiff className="files-changed-bar-review-icon" />
            <span>{reviewLabel}</span>
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="files-changed-bar-list" data-testid="files-changed-bar-list">
          {visibleFiles.map((file) => (
            <FilesChangedRow
              key={file.path}
              file={file}
              projectPath={props.projectPath}
              stat={stats?.byPath?.[file.path]}
              onReview={props.onReview}
            />
          ))}
          {hiddenCount > 0 ? (
            <li
              className="files-changed-bar-more"
              onClick={() => setShowAll(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowAll(true);
                }
              }}
              data-testid="files-changed-bar-more"
            >
              <IconMore className="files-changed-bar-more-icon" />
              <span>{isZh ? `展开剩余 ${hiddenCount} 个文件` : `Show ${hiddenCount} more`}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function FilesChangedRow(props: {
  file: MessageChangedFile;
  projectPath?: string | null | undefined;
  stat?: MessageChangedFileStat | undefined;
  onReview?: (() => void) | undefined;
}): ReactElement {
  const parts = formatDisplayPathParts(props.file.path, props.projectPath);

  return (
    <li
      className="files-changed-bar-row"
      title={props.file.path}
      onClick={props.onReview}
      role={props.onReview ? 'button' : undefined}
      tabIndex={props.onReview ? 0 : undefined}
      onKeyDown={(e) => {
        if (props.onReview && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          props.onReview();
        }
      }}
      data-testid="files-changed-bar-row"
    >
      <FileExtBadge path={props.file.path} />
      <span className="files-changed-bar-row-name">{parts.fileName}</span>
      {parts.dirPath ? <span className="files-changed-bar-row-dir">{parts.dirPath}</span> : null}
      {props.stat ? (
        <span className="files-changed-bar-row-stat">
          <span className="add">+{props.stat.additions}</span>
          <span className="del">-{props.stat.deletions}</span>
        </span>
      ) : null}
    </li>
  );
}
