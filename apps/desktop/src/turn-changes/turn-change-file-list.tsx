/**
 * The files of one sealed turn, listed directly under the turn-change card
 * header. Rows open that file's diff in place (before → after of this turn,
 * never the current file); past a few rows the rest fold behind a quiet
 * "还有 N 个文件" toggle, with the same rule as the per-call FilesChangedBar.
 */
import { useState, type ReactElement } from 'react';
import type { TurnChangeFileDiff, TurnChangeFileEntry, TurnChangeSummary } from '@piwin/contracts';
import { DiffCard, type DiffCardRequest } from '../tool-cards/diff-card';
import { ChangedFileRowContent, FILES_CHANGED_VISIBLE_ROWS } from '../files/files-changed-bar';
import type { TurnChangesApi } from './turn-changes-context.js';

type Copy = (zh: string, en: string) => string;

/** DiffCard only fetches when it has no `change`; the list always passes one. */
const unusedDiffRequest: DiffCardRequest = () =>
  Promise.resolve({
    type: 'response',
    command: 'git/diff-file',
    success: false,
    error: 'not used',
  });

export type TurnChangeFileListProps = {
  summary: TurnChangeSummary;
  api: TurnChangesApi;
  files: TurnChangeFileEntry[];
  projectPath?: string | null | undefined;
  t: Copy;
};

export function TurnChangeFileList(props: TurnChangeFileListProps): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, TurnChangeFileDiff | string>>({});

  const overflow = props.files.length - FILES_CHANGED_VISIBLE_ROWS;
  // A single hidden row costs as much space as the "show more" row itself.
  const collapsible = overflow > 1;
  const visible = collapsible && !showAll ? props.files.slice(0, FILES_CHANGED_VISIBLE_ROWS) : props.files;

  const openFile = (file: TurnChangeFileEntry): void => {
    setOpenFileId((current) => (current === file.fileId ? null : file.fileId));
    if (diffs[file.fileId] === undefined) {
      void props.api
        .diff(props.summary, file.fileId)
        .then((diff) => setDiffs((current) => ({ ...current, [file.fileId]: diff })))
        .catch((error: unknown) =>
          setDiffs((current) => ({
            ...current,
            [file.fileId]: error instanceof Error ? error.message : String(error),
          })),
        );
    }
  };

  return (
    <div className="turn-change-bar-files">
      <ul className="files-changed-bar-list" data-testid="turn-change-bar-files">
        {visible.map((file) => {
          const diff = diffs[file.fileId];
          const open = openFileId === file.fileId;
          return (
            <li key={file.fileId} className="files-changed-bar-item" title={file.relativePath}>
              <button
                type="button"
                className="files-changed-bar-row"
                aria-expanded={open}
                onClick={() => openFile(file)}
                data-testid="turn-change-bar-file"
              >
                <ChangedFileRowContent
                  path={file.relativePath}
                  status={file.kind}
                  projectPath={props.projectPath}
                  additions={file.additions}
                  deletions={file.deletions}
                />
              </button>
              {open ? (
                typeof diff === 'string' ? (
                  <p className="turn-change-bar-inline-note">{diff}</p>
                ) : diff ? (
                  <DiffCard
                    projectPath={props.projectPath ?? ''}
                    path={file.relativePath}
                    request={unusedDiffRequest}
                    chrome="body"
                    change={{
                      path: file.relativePath,
                      status: file.kind,
                      additions: file.additions,
                      deletions: file.deletions,
                      binary: file.binary,
                      ...(diff.patch !== undefined ? { patch: diff.patch } : {}),
                    }}
                  />
                ) : (
                  <p className="turn-change-bar-inline-note">{props.t('加载中…', 'Loading…')}</p>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      {collapsible ? (
        <button
          type="button"
          className="files-changed-bar-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((prev) => !prev)}
          data-testid="turn-change-bar-more"
        >
          {showAll ? props.t('收起', 'Show less') : props.t(`还有 ${overflow} 个文件`, `${overflow} more files`)}
        </button>
      ) : null}
    </div>
  );
}
