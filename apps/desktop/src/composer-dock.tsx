/**
 * Composer: empty = centered with path header; active session = bottom dock.
 * Context usage ring sits on the toolbar (no project chip — workspace is left sidebar).
 * Slash menu (`/`) surfaces commands, modes, and skills.
 * At menu (`@`) surfaces workspace files, git diffs, and MCP servers.
 * History navigation (`ArrowUp`/`ArrowDown`) lists the last 10 sent prompts.
 */
import { useMemo, type ReactElement } from 'react';
import { deriveGoalSessionView, GoalStickyStrip } from './goal';
import { SteerQueue } from './steer-queue';
import { ComposerActivityPill } from './composer-activity-pill';
import { ComposerCard } from './composer-card';
import { ComposerContextRail } from './composer-context-rail';
import type { ComposerDockProps } from './composer-dock-types';

export type { ComposerDockProps, ComposerModelOption } from './composer-dock-types';
export { ComposerCard } from './composer-card';

export function ComposerDock(props: ComposerDockProps): ReactElement {
  const isStreamingRun =
    props.streaming ||
    props.runPhase === 'streaming' ||
    props.runPhase === 'pausing' ||
    props.runPhase === 'aborting';
  const hasSteerQueue = (props.steerQueueMessages?.length ?? 0) > 0;
  const isQueuedEdit = props.queuedEdit != null;
  const goalMessages = props.goalMessages;
  // The Goal loop's real phase, derived from the goal_* tool calls in the
  // transcript rather than from run streaming state (see goal-session-model).
  const goalView = useMemo(
    () =>
      goalMessages && goalMessages.length > 0 && props.layoutMode === 'docked'
        ? deriveGoalSessionView({
            messages: goalMessages,
            streaming: props.streaming,
            agentMode: props.agentMode,
          })
        : null,
    [goalMessages, props.layoutMode, props.streaming, props.agentMode],
  );

  return (
    <footer
      className={`composer-dock layout-${props.layoutMode}${hasSteerQueue ? ' has-steer-queue' : ''}${isQueuedEdit ? ' is-queued-edit' : ''}`}
      data-testid="composer-dock"
      data-layout={props.layoutMode}
    >
      {/* Outside the input card: floating context layer (project / branch / runtime).
          Only displayed at the start of a session before user inputs (layoutMode === 'centered'). */}
      <ComposerContextRail
        layoutMode={props.layoutMode}
        projectPath={props.projectPath}
        recentProjects={props.recentProjects}
        onOpenProject={props.onOpenProject}
        branchRequest={props.branchRequest}
        onOpenWorktreeProject={props.onOpenWorktreeProject}
        isStreamingRun={isStreamingRun}
        runtimeRemoteConnected={props.runtimeRemoteConnected}
        runtimeRemoteHostLabel={props.runtimeRemoteHostLabel}
        onSelectLocalRuntime={props.onSelectLocalRuntime}
        onSelectAttachRuntime={props.onSelectAttachRuntime}
      />
      <ComposerActivityPill
        orchestrationView={props.orchestrationView}
        jobs={props.activeJobs ?? []}
        onStopJob={props.onStopJob ?? (() => {})}
        onViewJobLogs={props.onViewJobLogs ?? (() => {})}
        onCancelSubagentBatch={props.onCancelSubagentBatch ?? (() => {})}
        {...(props.onCancelSubagentBatches
          ? { onCancelSubagentBatches: props.onCancelSubagentBatches }
          : {})}
        {...(props.isSubagentStopping ? { isSubagentStopping: props.isSubagentStopping } : {})}
        onOpenTasks={props.onOpenTasks ?? (() => {})}
      />
      {goalView && goalView.phase !== 'idle' && goalMessages ? (
        <GoalStickyStrip
          view={goalView}
          messages={goalMessages}
          onAbort={props.onAbort}
          onExit={() => props.onAgentModeChange('agent')}
        />
      ) : null}
      {props.steerQueueMessages && props.steerQueueMessages.length > 0 ? (
        <SteerQueue
          messages={props.steerQueueMessages}
          onSendNow={props.onSteerQueueSendNow || (() => {})}
          onEdit={props.onSteerQueueEdit || (() => {})}
          onRemove={props.onSteerQueueRemove || (() => {})}
          editingMessageId={props.queuedEdit?.messageId ?? null}
          onCancelEdit={props.onQueuedEditCancel}
        />
      ) : null}
      <ComposerCard {...props} />
    </footer>
  );
}
