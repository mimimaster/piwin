/**
 * Turn-level "N files changed" bar under an assistant reply.
 * Lists files mutated by tools on that message; Review opens the Changes panel.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { GitDiffSummary, HostResponse } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import {
  collectMessageChangedFiles,
  matchChangedFileStats,
  type MessageChangedFile,
} from './collect-message-changed-files';
import { IconChevronDown, IconFile } from './shell-icons';

export type FilesChangedBarRequest = (command: {
  type: 'git/diff-summary';
  projectPath: string;
}) => Promise<HostResponse>;

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
  const [stats, setStats] = useState<{ additions: number; deletions: number } | null>(null);

  const pathsKey = files.map((f) => f.path).join('\0');

  useEffect(() => {
    if (!props.projectPath || !props.request || files.length === 0) {
      setStats(null);
      return;
    }
    let cancelled = false;
    const projectPath = props.projectPath;
    const request = props.request;
    void request({ type: 'git/diff-summary', projectPath })
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setStats(null);
          return;
        }
        const summary = (response.data as { summary: GitDiffSummary }).summary;
        const matched = matchChangedFileStats(files, summary.files);
        if (matched.matchedPaths.length === 0 && matched.additions === 0 && matched.deletions === 0) {
          setStats(null);
          return;
        }
        setStats({ additions: matched.additions, deletions: matched.deletions });
      })
      .catch(() => {
        if (!cancelled) setStats(null);
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
  const singleFile = files.length === 1 ? files[0] : null;

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
          <IconFile className="files-changed-bar-icon" />
          <span className="files-changed-bar-count">{countLabel}</span>
          {singleFile && !expanded ? (
            <span className="files-changed-bar-file-inline" title={singleFile.path}>
              <IconFile className="files-changed-bar-file-inline-icon" />
              <span className="files-changed-bar-file-name">{singleFile.name}</span>
            </span>
          ) : null}
          {stats && (stats.additions > 0 || stats.deletions > 0) ? (
            <span className="files-changed-bar-stat" data-testid="files-changed-bar-stat">
              {stats.additions > 0 ? (
                <span className="add">+{stats.additions}</span>
              ) : null}
              {stats.additions > 0 && stats.deletions > 0 ? ' ' : null}
              {stats.deletions > 0 ? (
                <span className="del">-{stats.deletions}</span>
              ) : null}
            </span>
          ) : null}
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
            {reviewLabel}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="files-changed-bar-list" data-testid="files-changed-bar-list">
          {files.map((file) => (
            <FilesChangedRow key={file.path} file={file} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FilesChangedRow(props: { file: MessageChangedFile }): ReactElement {
  return (
    <li className="files-changed-bar-row" title={props.file.path}>
      <IconFile className="files-changed-bar-row-icon" />
      <span className="files-changed-bar-row-name">{props.file.name}</span>
      <span className="files-changed-bar-row-path">{props.file.path}</span>
    </li>
  );
}
