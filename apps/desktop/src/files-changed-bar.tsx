/**
 * Turn-level "N files changed" card under a finished assistant turn.
 * Header carries the count, line totals and Review; the files themselves are
 * listed directly below (first few, the rest behind a "show more" row).
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
import { IconGit } from './shell-icons';
import {
  formatDisplayPathParts,
  getRelativeFilePath,
  type DisplayPathParts,
} from './truncate-relative-path';

export { formatDisplayPathParts, getRelativeFilePath };
export type { DisplayPathParts };

export type FilesChangedBarRequest = (command: {
  type: 'git/diff-summary';
  projectPath: string;
}) => Promise<HostResponse>;

/** Session-open can mount many FilesChangedBar rows; share one in-flight/result per project. */
const GIT_DIFF_SUMMARY_CACHE_TTL_MS = 15_000;
export const MAX_GIT_DIFF_SUMMARY_CACHE_ENTRIES = 24;
const gitDiffSummaryCache = new Map<
  string,
  { expiresAt: number; promise: Promise<HostResponse> }
>();

function pruneGitDiffSummaryCache(now: number): void {
  for (const [path, entry] of gitDiffSummaryCache) {
    if (entry.expiresAt <= now) {
      gitDiffSummaryCache.delete(path);
    }
  }
  while (gitDiffSummaryCache.size >= MAX_GIT_DIFF_SUMMARY_CACHE_ENTRIES) {
    const oldestPath = gitDiffSummaryCache.keys().next().value;
    if (oldestPath === undefined) break;
    gitDiffSummaryCache.delete(oldestPath);
  }
}

/** Rows shown before the "show N more" row; most turns touch at most this many. */
export const FILES_CHANGED_VISIBLE_ROWS = 3;

function requestGitDiffSummaryCached(
  request: FilesChangedBarRequest,
  projectPath: string,
): Promise<HostResponse> {
  const now = Date.now();
  const cached = gitDiffSummaryCache.get(projectPath);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }
  gitDiffSummaryCache.delete(projectPath);
  pruneGitDiffSummaryCache(now);
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

export function clearGitDiffSummaryCacheForTests(): void {
  gitDiffSummaryCache.clear();
}

export function gitDiffSummaryCacheSizeForTests(): number {
  return gitDiffSummaryCache.size;
}

export type FilesChangedBarProps = {
  tools: readonly ToolCardUi[];
  /** When false, hide the bar (e.g. the turn is still running). */
  visible?: boolean;
  projectPath?: string | null;
  request?: FilesChangedBarRequest;
  /** Open the Review / Changes inspector tab. */
  onReview?: () => void;
  locale?: 'zh-CN' | 'en';
};

function formatCountLabel(count: number, isZh: boolean): string {
  if (isZh) {
    return `${count} 个文件已更改`;
  }
  return count === 1 ? '1 file changed' : `${count} files changed`;
}

export function FilesChangedBar(props: FilesChangedBarProps): ReactElement | null {
  const isZh = props.locale === 'zh-CN';
  const files = useMemo(() => collectMessageChangedFiles(props.tools), [props.tools]);
  const [showAll, setShowAll] = useState(false);
  const [stats, setStats] = useState<{
    additions: number;
    deletions: number;
    byPath?: Record<string, MessageChangedFileStat>;
  } | null>(null);

  const pathsKey = files.map((f) => f.path).join('\0');
  const active = props.visible !== false && files.length > 0;

  useEffect(() => {
    if (!active) {
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
          ? matchChangedFileStats(
              files,
              (response.data as { summary: GitDiffSummary }).summary.files,
            )
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
  }, [active, props.projectPath, props.request, pathsKey]);

  if (!active) {
    return null;
  }

  const overflow = files.length - FILES_CHANGED_VISIBLE_ROWS;
  // A single hidden row costs as much space as the "show more" row itself.
  const collapsible = overflow > 1;
  const visibleFiles =
    collapsible && !showAll ? files.slice(0, FILES_CHANGED_VISIBLE_ROWS) : files;

  return (
    <section
      className="fcb files-changed-bar"
      aria-label={formatCountLabel(files.length, isZh)}
      data-testid="files-changed-bar"
    >
      <header className="files-changed-bar-head">
        <IconGit className="i files-changed-bar-glyph" />
        <span className="files-changed-bar-count">{formatCountLabel(files.length, isZh)}</span>
        {stats ? (
          <LineStat
            className="files-changed-bar-stat"
            additions={stats.additions}
            deletions={stats.deletions}
            testId="files-changed-bar-stat"
          />
        ) : null}
        {props.onReview ? (
          <button
            type="button"
            className="files-changed-bar-review"
            onClick={props.onReview}
            data-testid="files-changed-bar-review"
          >
            {isZh ? '审查' : 'Review'}
            <span className="files-changed-bar-review-arrow" aria-hidden="true">
              →
            </span>
          </button>
        ) : null}
      </header>
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
      </ul>
      {collapsible ? (
        <button
          type="button"
          className="files-changed-bar-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((prev) => !prev)}
          data-testid="files-changed-bar-more"
        >
          {showAll
            ? isZh
              ? '收起'
              : 'Show less'
            : isZh
              ? `还有 ${overflow} 个文件`
              : `${overflow} more files`}
        </button>
      ) : null}
    </section>
  );
}

/** "+a −d"; a zero side is dropped so an add-only turn does not show a red −0. */
function LineStat(props: {
  className: string;
  additions: number;
  deletions: number;
  testId?: string;
}): ReactElement | null {
  if (props.additions === 0 && props.deletions === 0) {
    return null;
  }
  return (
    <span className={`${props.className} pm`} data-testid={props.testId}>
      {props.additions > 0 ? <span className="add">+{props.additions}</span> : null}
      {props.deletions > 0 ? <span className="del">−{props.deletions}</span> : null}
    </span>
  );
}

const MODIFIED_TAG = { letter: 'M', tone: 'mod' };
const STATUS_TAGS: Record<string, { letter: string; tone: string }> = {
  added: { letter: 'A', tone: 'add' },
  untracked: { letter: 'A', tone: 'add' },
  modified: MODIFIED_TAG,
  typechange: MODIFIED_TAG,
  deleted: { letter: 'D', tone: 'del' },
  renamed: { letter: 'R', tone: 'ren' },
  copied: { letter: 'C', tone: 'ren' },
  conflicted: { letter: 'U', tone: 'del' },
};

function FilesChangedRow(props: {
  file: MessageChangedFile;
  projectPath?: string | null | undefined;
  stat?: MessageChangedFileStat | undefined;
  onReview?: (() => void) | undefined;
}): ReactElement {
  const parts = formatDisplayPathParts(props.file.path, props.projectPath);
  const tag = STATUS_TAGS[props.stat?.status ?? 'modified'] ?? MODIFIED_TAG;
  const content = (
    <>
      <span className={`files-changed-bar-row-tag ${tag.tone}`}>{tag.letter}</span>
      <span className="files-changed-bar-row-path">
        <span className="files-changed-bar-row-name">{parts.fileName}</span>
        {parts.dirPath ? (
          <span className="files-changed-bar-row-dir">{parts.dirPath}</span>
        ) : null}
      </span>
      {props.stat ? (
        <LineStat
          className="files-changed-bar-row-stat"
          additions={props.stat.additions}
          deletions={props.stat.deletions}
        />
      ) : null}
    </>
  );

  return (
    <li className="files-changed-bar-item" title={props.file.path}>
      {props.onReview ? (
        <button
          type="button"
          className="files-changed-bar-row"
          onClick={props.onReview}
          data-testid="files-changed-bar-row"
        >
          {content}
        </button>
      ) : (
        <div className="files-changed-bar-row" data-testid="files-changed-bar-row">
          {content}
        </div>
      )}
    </li>
  );
}
