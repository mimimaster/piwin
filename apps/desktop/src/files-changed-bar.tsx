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
import { IconChevronDown, IconGit } from './shell-icons';
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

const DEFAULT_MAX_VISIBLE_ROWS = 5;
/** Chips that do not fit wrap onto a clipped second line instead of squeezing. */
const MAX_HEAD_CHIPS = 3;

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
  /** When false, hide the bar even if tools have paths (e.g. still streaming with no writes). */
  visible?: boolean;
  projectPath?: string | null;
  request?: FilesChangedBarRequest;
  /** Open the Review / Changes inspector tab. */
  onReview?: () => void;
  locale?: 'zh-CN' | 'en';
};

function formatCountLabel(count: number, isZh: boolean): string {
  if (isZh) {
    return count === 1 ? '1 个文件已更改' : `${count} 个文件已更改`;
  }
  return count === 1 ? '1 File Changed' : `${count} files changed`;
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
  const chipFiles = files.slice(0, MAX_HEAD_CHIPS);

  return (
    <div
      className="fcb files-changed-bar"
      data-expanded={expanded ? 'true' : 'false'}
      data-testid="files-changed-bar"
    >
      <div className="files-changed-bar-head">
        <button
          type="button"
          className="files-changed-bar-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          data-testid="files-changed-bar-toggle"
        >
          <IconGit className="i files-changed-bar-glyph" />
          <span className="files-changed-bar-count">{countLabel}</span>
          {stats ? (
            <>
              <span className="files-changed-bar-stat pm" data-testid="files-changed-bar-stat">
                <span className="add plus">+{stats.additions}</span>{' '}
                <span className="del minus">−{stats.deletions}</span>
              </span>
              <DiffBlocks additions={stats.additions} deletions={stats.deletions} />
            </>
          ) : null}
          {expanded ? null : (
            <span className="files-changed-bar-chips">
              {chipFiles.map((file) => (
                <span key={file.path} className="pc files-changed-bar-chip" title={file.path}>
                  {formatDisplayPathParts(file.path, props.projectPath).fileName}
                </span>
              ))}
            </span>
          )}
          <IconChevronDown
            className={expanded ? 'files-changed-bar-chevron open' : 'files-changed-bar-chevron'}
          />
        </button>
        {props.onReview ? (
          <button
            type="button"
            className="files-changed-bar-review"
            onClick={props.onReview}
            data-testid="files-changed-bar-review"
          >
            {reviewLabel} <span aria-hidden="true">↗</span>
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
              {isZh ? `展开剩余 ${hiddenCount} 个文件` : `Show ${hiddenCount} more`}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

const DIFF_BLOCK_COUNT = 5;

/** GitHub-style diffstat: five squares split by the add/delete ratio. */
function DiffBlocks(props: { additions: number; deletions: number }): ReactElement {
  const total = props.additions + props.deletions;
  let added = total === 0 ? 0 : Math.round((props.additions / total) * DIFF_BLOCK_COUNT);
  if (props.additions > 0 && added === 0) added = 1;
  if (props.deletions > 0 && added === DIFF_BLOCK_COUNT) added = DIFF_BLOCK_COUNT - 1;
  const deleted = total === 0 ? 0 : DIFF_BLOCK_COUNT - added;
  return (
    <span className="files-changed-bar-blocks" aria-hidden="true">
      {Array.from({ length: DIFF_BLOCK_COUNT }, (_, index) => (
        <i
          key={index}
          className={index < added ? 'add' : index < added + deleted ? 'del' : undefined}
        />
      ))}
    </span>
  );
}

const MODIFIED_TAG = { letter: 'M', tone: 'mod' };
const STATUS_TAGS: Record<string, { letter: string; tone: string }> = {
  added: { letter: 'A', tone: 'add' },
  untracked: { letter: 'A', tone: 'add' },
  modified: MODIFIED_TAG,
  typechange: { letter: 'M', tone: 'mod' },
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
      <span className={`files-changed-bar-row-tag ${tag.tone}`}>{tag.letter}</span>
      <span className="files-changed-bar-row-name">{parts.fileName}</span>
      {parts.dirPath ? <span className="files-changed-bar-row-dir">{parts.dirPath}</span> : null}
      {props.stat ? (
        <span className="files-changed-bar-row-stat pm">
          <span className="add">+{props.stat.additions}</span>{' '}
          <span className="del">−{props.stat.deletions}</span>
        </span>
      ) : null}
      {props.stat ? (
        <DiffBlocks additions={props.stat.additions} deletions={props.stat.deletions} />
      ) : null}
    </li>
  );
}
