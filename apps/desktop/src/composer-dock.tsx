/**
 * Composer: empty = centered with path header; active session = bottom dock.
 * Context usage ring sits on the toolbar (no project chip — workspace is left sidebar).
 * Slash menu (`/`) surfaces commands, modes, and skills.
 * At menu (`@`) surfaces workspace files, git diffs, and MCP servers.
 * History navigation (`ArrowUp`/`ArrowDown`) lists the last 10 sent prompts.
 */
import type { ReactElement } from 'react';
import { SteerQueue } from './steer-queue';
import { ActiveJobsStrip } from './active-jobs-strip';
import { ComposerCard } from './composer-card';
import { ComposerContextRail } from './composer-context-rail';
import type { ComposerDockProps } from './composer-dock-types';
import { useDesktopLocale } from './desktop-locale-context';

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
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';

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
      {props.activeJobs && props.activeJobs.length > 0 ? (
        <ActiveJobsStrip
          jobs={props.activeJobs}
          onStop={props.onStopJob ?? (() => {})}
          onViewLogs={props.onViewJobLogs ?? (() => {})}
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
      <div className="hint composer-hint" data-testid="composer-hint">
        {isStreamingRun ? (
          <>
            <span>{isChinese ? '运行中 Enter 排队' : 'Enter queues while running'}</span>
            <span>{isChinese ? '⌘Enter 介入' : '⌘Enter steers'}</span>
          </>
        ) : isQueuedEdit ? (
          <>
            <span>{isChinese ? 'Enter 保存回队列' : 'Enter saves to queue'}</span>
            <span>{isChinese ? 'Esc 取消' : 'Esc cancels'}</span>
          </>
        ) : (
          <>
            <span>{isChinese ? 'Enter 发送' : 'Enter sends'}</span>
            <span>{isChinese ? '⇧Enter 换行' : '⇧Enter new line'}</span>
            <span>{isChinese ? '⌘Enter 介入' : '⌘Enter steers'}</span>
          </>
        )}
      </div>
    </footer>
  );
}
