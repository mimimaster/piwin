import type { ReactElement } from 'react';
import { DiffCard, type DiffCardRequest } from './diff-card';

export type FileDiffInspectorProps = {
  projectPath: string;
  path: string;
  request: DiffCardRequest;
};

/** Right-inspector surface for a single edited file's git diff. */
export function FileDiffInspector(props: FileDiffInspectorProps): ReactElement {
  return (
    <div className="file-diff-inspector" data-testid="file-diff-inspector">
      <DiffCard projectPath={props.projectPath} path={props.path} request={props.request} />
    </div>
  );
}
