/**
 * SessionContextRow — project · branch chips (proto-00 `.session-context`).
 * Project sessions only. Inkstone mounts this in StageHeader trailing; Deck
 * still uses it as a stage-top row. Controls reuse the composer rail chips.
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
