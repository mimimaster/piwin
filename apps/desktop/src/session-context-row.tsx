/**
 * SessionContextRow — the stage-top context line of proto-00-shell.html
 * (`.session-context`). Project sessions show project chip · branch chip.
 * General conversations render nothing to keep the stage clean and increase
 * available chat display height.
 * The chips reuse the composer rail controls so recent-project switching and
 * branch checkout behave identically in both places.
 */
import type { ReactElement } from 'react';
import type { HostResponse, ProjectRecord } from '@piwin/contracts';
import { BranchChip, type BranchChipRequest } from './branch-chip';
import { ProjectChip } from './project-chip';
import { projectLabel } from './project-display-name';

export type SessionContextRowProps = {
  /** null = general conversation: renders nothing. */
  projectPath: string | null;
  recentProjects: readonly ProjectRecord[];
  request: (command: BranchChipRequest) => Promise<HostResponse>;
  onOpenProject?: (path: string) => void;
  onOpenWorktreeProject?: (worktreePath: string) => void | Promise<void>;
  /** Branch switching is suspended while the agent is streaming. */
  disabled?: boolean;
};

export function SessionContextRow(props: SessionContextRowProps): ReactElement | null {
  const projectPath = props.projectPath?.trim() || null;
  if (projectPath === null) {
    return null;
  }
  return (
    <div className="session-context" data-testid="session-context-row">
      {props.onOpenProject ? (
        <ProjectChip
          projectPath={projectPath}
          recentProjects={props.recentProjects}
          onOpenProject={props.onOpenProject}
        />
      ) : (
        <span
          className="composer-context-link is-static"
          data-testid="session-context-project"
          title={projectPath}
        >
          <span className="composer-context-link-label">
            {projectLabel(projectPath, props.recentProjects)}
          </span>
        </span>
      )}
      <BranchChip
        projectPath={projectPath}
        request={props.request}
        {...(props.disabled === true ? { disabled: true } : {})}
        {...(props.onOpenWorktreeProject
          ? { onOpenWorktreeProject: props.onOpenWorktreeProject }
          : {})}
      />
    </div>
  );
}
