import type { ReactElement } from 'react';
import { BranchChip } from './branch-chip';
import { RuntimeTargetChip } from './runtime-target-chip';
import { ProjectChip } from './project-chip';
import { projectLabel } from './project-display-name';
import type { ComposerDockProps } from './composer-dock-types';

export function ComposerContextRail(props: {
  layoutMode: ComposerDockProps['layoutMode'];
  projectPath: ComposerDockProps['projectPath'];
  recentProjects: ComposerDockProps['recentProjects'];
  onOpenProject: ComposerDockProps['onOpenProject'];
  branchRequest: ComposerDockProps['branchRequest'];
  onOpenWorktreeProject: ComposerDockProps['onOpenWorktreeProject'];
  isStreamingRun: boolean;
  runtimeRemoteConnected: ComposerDockProps['runtimeRemoteConnected'];
  runtimeRemoteHostLabel: ComposerDockProps['runtimeRemoteHostLabel'];
  onSelectLocalRuntime: ComposerDockProps['onSelectLocalRuntime'];
  onSelectAttachRuntime: ComposerDockProps['onSelectAttachRuntime'];
}): ReactElement | null {
  if (props.layoutMode !== 'centered') {
    return null;
  }
  return (
    <div className="composer-context-rail" data-testid="composer-context-row">
      {props.onOpenProject && props.projectPath ? (
        <ProjectChip
          projectPath={props.projectPath}
          recentProjects={props.recentProjects ?? []}
          onOpenProject={props.onOpenProject}
        />
      ) : props.projectPath ? (
        <span
          className="composer-context-link is-static"
          data-testid="composer-project-chip"
          title={props.projectPath}
        >
          <span className="composer-context-link-label">
            {projectLabel(props.projectPath, props.recentProjects ?? [])}
          </span>
        </span>
      ) : null}
      {props.branchRequest && props.projectPath ? (
        <BranchChip
          projectPath={props.projectPath}
          disabled={props.isStreamingRun}
          request={props.branchRequest}
          {...(props.onOpenWorktreeProject ? { onOpenWorktreeProject: props.onOpenWorktreeProject } : {})}
        />
      ) : null}
      <RuntimeTargetChip
        {...(props.runtimeRemoteConnected === true ? { remoteConnected: true } : {})}
        {...(props.runtimeRemoteHostLabel ? { hostLabel: props.runtimeRemoteHostLabel } : {})}
        {...(props.onSelectLocalRuntime ? { onSelectLocal: props.onSelectLocalRuntime } : {})}
        {...(props.onSelectAttachRuntime ? { onSelectAttach: props.onSelectAttachRuntime } : {})}
      />
    </div>
  );
}
