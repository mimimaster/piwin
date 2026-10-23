/**
 * SessionContextRow — project · branch chips (proto-00 `.session-context`).
 * Project sessions only. Inkstone mounts this in StageHeader trailing; Deck
 * still uses it as a stage-top row. Controls reuse the composer rail chips.
 */
import type { ReactElement } from 'react';
import type { HostResponse, ProjectRecord } from '@piwin/contracts';
import { BranchChip, type BranchChipRequest } from './branch-chip';
import { ProjectChip } from '../sidebar/project-chip';
import { projectLabel } from '../sidebar/project-display-name';
import { SessionWorkingTreeChip, type WorkingTreeStatRequest } from './session-working-tree-chip';

export type SessionContextRowProps = {
  /** null = general conversation: renders nothing. */
  projectPath: string | null;
  recentProjects: readonly ProjectRecord[];
  request: (command: BranchChipRequest | WorkingTreeStatRequest) => Promise<HostResponse>;
  /** Opens the Changes surface. The chip stays a label when omitted. */
  onOpenChanges?: () => void;
  onOpenProject?: (path: string) => void;
  onOpenWorktreeProject?: (worktreePath: string) => void | Promise<void>;
  /** Branch switching is suspended while the agent is streaming. */
  disabled?: boolean;
  /**
   * Project switching is only for a conversation that has not started.
   * Once messages exist (or a transcript is being restored) the chip
   * renders as a static label.
   */
  projectSwitchLocked?: boolean;
};

export function SessionContextRow(props: SessionContextRowProps): ReactElement | null {
  const projectPath = props.projectPath?.trim() || null;
  if (projectPath === null) {
    return null;
  }
  const projectSwitchable = props.onOpenProject !== undefined && props.projectSwitchLocked !== true;
  return (
    <div className="session-context" data-testid="session-context-row">
      {projectSwitchable && props.onOpenProject ? (
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
      <SessionWorkingTreeChip
        projectPath={projectPath}
        request={props.request}
        {...(props.onOpenChanges ? { onOpen: props.onOpenChanges } : {})}
      />
    </div>
  );
}
