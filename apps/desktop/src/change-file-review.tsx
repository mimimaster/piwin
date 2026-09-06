import { useEffect, useState, type ReactElement } from 'react';
import type { GitFileDiff, HostResponse } from '@piwin/contracts';
import { Notice } from '@piwin/ui-kit';
import { DiffView } from './diff-view';
import { ChangeFileHeader } from './change-file-header';

export type ChangeFileReviewRequest = (command: {
  type: 'git/diff-file';
  projectPath: string;
  path: string;
  scope?: 'worktree' | 'staged' | 'combined';
}) => Promise<HostResponse>;

export type ChangeFileReviewProps = {
  projectPath: string;
  relativePath: string;
  status?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  request: ChangeFileReviewRequest;
  onBack: () => void;
  locale?: 'zh-CN' | 'en' | undefined;
};

type FileDiffState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; fileDiff: GitFileDiff };

export function ChangeFileReview(props: ChangeFileReviewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const [state, setState] = useState<FileDiffState>({ kind: 'loading' });
  // proto-04 b09: DiffView supports split, but Changes never wires a mode toggle.

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    void props
      .request({
        type: 'git/diff-file',
        projectPath: props.projectPath,
        path: props.relativePath,
        scope: 'combined',
      })
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setState({ kind: 'error', message: response.error });
          return;
        }
        setState({
          kind: 'ready',
          fileDiff: (response.data as { diff: GitFileDiff }).diff,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: String(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relativePath, props.request]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onBack();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [props.onBack]);

  const additions =
    state.kind === 'ready' && state.fileDiff.additions !== undefined
      ? state.fileDiff.additions
      : props.additions;
  const deletions =
    state.kind === 'ready' && state.fileDiff.deletions !== undefined
      ? state.fileDiff.deletions
      : props.deletions;

  return (
    <div className="change-file-review" data-testid="change-file-review">
      <ChangeFileHeader
        relativePath={props.relativePath}
        projectPath={props.projectPath}
        status={props.status}
        additions={additions}
        deletions={deletions}
        locale={props.locale}
        onBack={props.onBack}
      />

      <div className="change-file-review-body">
        {state.kind === 'loading' ? (
          <div className="change-file-state-message muted" data-testid="change-file-loading">
            {isZh ? '正在加载变更…' : 'Loading diff…'}
          </div>
        ) : state.kind === 'error' ? (
          <div className="change-file-state-error">
            <Notice tone="error">{state.message}</Notice>
          </div>
        ) : (
          <DiffView
            patch={state.fileDiff.patch}
            mode="unified"
            path={props.relativePath}
            isBinary={state.fileDiff.isBinary}
            truncated={state.fileDiff.truncated}
            hideHeader={true}
            hideMetadata={true}
            locale={props.locale}
            emptyMessage={isZh ? '无文本变更' : 'No textual changes'}
          />
        )}
      </div>
    </div>
  );
}
