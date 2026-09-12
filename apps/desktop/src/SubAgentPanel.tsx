import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  HostResponse,
  SessionSummary,
  SubagentBatchProjection,
  SubagentInvocation,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { Button, EmptyState, Notice, StatusBadge, type StatusTone } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import { useConfirmDialog } from './use-confirm-dialog';
import { formatToolDuration } from './tool-call-head';
import type { SubagentStreamState } from './chat-reducer';
import { IconActivity } from './shell-icons';
import {
  deriveSubagentOrchestrationView,
  subagentInvocationDomId,
  type SubagentOrchestrationItem,
} from './subagent-orchestration-view';
import {
  childSummariesToLegacyActivities,
  formatTasksBatchHeader,
  groupTasksOverview,
  orchestrationItemDurationMs,
  type TasksOverviewBatch,
} from './subagent-tasks-overview';

type SubAgentRequest = {
  type: 'session/list-children';
  parentSessionId: string;
} | {
  type: 'subagent/batch-cancel';
  runId: string;
};

export type SubAgentPanelProps = {
  parentSessionId: string | null;
  request: (command: SubAgentRequest) => Promise<HostResponse>;
  onOpenSession: (sessionId: string) => void;
  onClose?: () => void;
  variant?: 'drawer' | 'embedded';
  /** Live child list from host pushes; when provided, it supersedes local reload. */
  children?: SessionSummary[];
  /** Active batch projections for the selected parent session. */
  batches?: Record<string, SubagentBatchProjection>;
  /** Live invocation records from host pushes; skips list-children when set. */
  invocations?: Record<string, SubagentInvocation>;
  /** Live child streams for latest-activity lines. */
  streams?: Record<string, SubagentStreamState>;
};

function executionBadge(
  status: SubagentOrchestrationItem['executionStatus'],
  locale: 'zh-CN' | 'en',
): { tone: StatusTone; label: string } {
  const zh = locale === 'zh-CN';
  switch (status) {
    case 'queued':
    case 'starting':
      return { tone: 'neutral', label: zh ? '排队中' : 'Queued' };
    case 'running':
      return { tone: 'running', label: zh ? '运行中' : 'Running' };
    case 'completed':
      return { tone: 'success', label: zh ? '已完成' : 'Completed' };
    case 'failed':
      return { tone: 'danger', label: zh ? '失败' : 'Failed' };
    case 'cancelled':
      return { tone: 'neutral', label: zh ? '已取消' : 'Cancelled' };
  }
}

function attentionBadges(
  item: SubagentOrchestrationItem,
  locale: 'zh-CN' | 'en',
): Array<{ tone: StatusTone; label: string; testId: string }> {
  const zh = locale === 'zh-CN';
  const badges: Array<{ tone: StatusTone; label: string; testId: string }> = [];
  if (item.summaryStatus === 'pending') {
    badges.push({
      tone: 'warning',
      label: zh ? '报告待收集' : 'Report pending',
      testId: 'subagent-tasks-report-pending',
    });
  }
  if (item.integrationStatus === 'pending') {
    badges.push({
      tone: 'warning',
      label: zh ? '代码待处理' : 'Code pending',
      testId: 'subagent-tasks-code-pending',
    });
  } else if (item.integrationStatus === 'conflict') {
    badges.push({
      tone: 'danger',
      label: zh ? '冲突' : 'Conflict',
      testId: 'subagent-tasks-code-conflict',
    });
  }
  return badges;
}

function TaskRow(props: {
  item: SubagentOrchestrationItem;
  locale: 'zh-CN' | 'en';
  onOpenSession: (sessionId: string) => void;
}): ReactElement {
  const { item, locale } = props;
  const zh = locale === 'zh-CN';
  const execution = executionBadge(item.executionStatus, locale);
  const attention = attentionBadges(item, locale);
  const durationMs = orchestrationItemDurationMs(item);
  const duration = durationMs !== undefined ? formatToolDuration(durationMs) : undefined;
  const title = item.role ? `${item.role} · ${item.title}` : item.title;
  const href =
    item.invocationId !== undefined ? `#${subagentInvocationDomId(item.invocationId)}` : undefined;

  return (
    <li
      className="ext-list-item subagent-tasks-row"
      data-testid="subagent-task-row"
      data-execution-status={item.executionStatus}
      data-anchor-id={item.anchorId}
    >
      <div className="ext-list-main">
        <div className="ext-list-title">
          {href ? (
            <a className="subagent-tasks-anchor" href={href}>
              {title}
            </a>
          ) : (
            <strong>{title}</strong>
          )}
          <StatusBadge tone={execution.tone} label={execution.label} />
          {attention.map((badge) => (
            <StatusBadge
              key={badge.testId}
              tone={badge.tone}
              label={badge.label}
              testId={badge.testId}
            />
          ))}
        </div>
        <div className="muted ext-desc">{item.activity}</div>
        {duration ? (
          <div className="muted subagent-tasks-duration" data-testid="subagent-task-duration">
            {duration}
          </div>
        ) : null}
      </div>
      {item.childSessionId ? (
        <Button
          size="compact"
          variant="ghost"
          onClick={() => {
            if (item.childSessionId) props.onOpenSession(item.childSessionId);
          }}
        >
          {zh ? '打开' : 'Open'}
        </Button>
      ) : null}
    </li>
  );
}

export function SubAgentPanel(props: SubAgentPanelProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const localeTag: 'zh-CN' | 'en' = isChinese ? 'zh-CN' : 'en';
  const [fetchedChildren, setFetchedChildren] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();
  const hasLiveProjection = props.children !== undefined || props.invocations !== undefined;

  const reload = useCallback(async (): Promise<void> => {
    if (!props.parentSessionId) {
      setFetchedChildren([]);
      return;
    }
    setError(null);
    const response = await props.request({
      type: 'session/list-children',
      parentSessionId: props.parentSessionId,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setFetchedChildren((response.data as { sessions: SessionSummary[] }).sessions ?? []);
  }, [props.parentSessionId, props.request]);

  useEffect(() => {
    if (hasLiveProjection) {
      return;
    }
    void reload();
  }, [hasLiveProjection, reload]);

  const effectiveChildren = props.children ?? fetchedChildren;
  const childrenRecord = useMemo(
    () => Object.fromEntries(effectiveChildren.map((child) => [child.id, child])),
    [effectiveChildren],
  );
  const view = useMemo(() => {
    if (!props.parentSessionId) {
      return deriveSubagentOrchestrationView({
        parentSessionId: '',
        invocations: {},
        children: {},
        streams: {},
      });
    }
    return deriveSubagentOrchestrationView({
      parentSessionId: props.parentSessionId,
      invocations: props.invocations ?? {},
      children: childrenRecord,
      streams: props.streams ?? {},
      legacyActivities: childSummariesToLegacyActivities(effectiveChildren),
    });
  }, [
    props.parentSessionId,
    props.invocations,
    props.streams,
    childrenRecord,
    effectiveChildren,
  ]);
  const overview = useMemo(
    () =>
      groupTasksOverview({
        view,
        ...(props.batches !== undefined ? { batches: props.batches } : {}),
      }),
    [view, props.batches],
  );
  const hasTasks = overview.activeBatches.length > 0 || overview.recentItems.length > 0;

  const cancelBatch = useCallback(
    async (batch: TasksOverviewBatch): Promise<void> => {
      if (batch.needsConfirm) {
        const confirmed = await confirmDialog.confirm({
          title: isChinese ? '停止批次？' : 'Stop this batch?',
          description: isChinese
            ? '有改动尚未合入。停止后这些改动可能无法继续处理。'
            : 'Changes are still awaiting integration. Stopping may leave them unapplied.',
          confirmLabel: isChinese ? '停止批次' : 'Stop batch',
          cancelLabel: isChinese ? '取消' : 'Cancel',
          tone: 'danger',
        });
        if (!confirmed) {
          return;
        }
      }
      setCancellingRunId(batch.runId);
      try {
        const response = await props.request({
          type: 'subagent/batch-cancel',
          runId: batch.runId,
        });
        if (!response.success) {
          setError(response.error);
        }
      } catch (requestError: unknown) {
        setError(formatError(requestError));
      } finally {
        setCancellingRunId(null);
      }
    },
    [confirmDialog, isChinese, props],
  );

  if (!error && !hasTasks && props.variant === 'embedded') {
    return null;
  }

  if (!error && !hasTasks) {
    return (
      <div className="subagent-tasks-overview" data-testid="subagent-panel">
        <EmptyState
          testId="subagent-tasks-empty"
          size="compact"
          title={isChinese ? '暂无后台任务' : 'No background tasks'}
          description={
            isChinese
              ? '模型委派子任务后，会在这里汇总进度。对话里的卡片仍是第一现场。'
              : 'When the model delegates work, progress lands here. Transcript cards stay the in-context signal.'
          }
          visual={<IconActivity width={28} height={28} />}
          seal={isChinese ? '任' : 'T'}
        />
      </div>
    );
  }

  return (
    <div
      className={
        props.variant === 'embedded'
          ? 'settings-section settings-section-card subagent-tasks-overview'
          : 'settings-inline-content subagent-tasks-overview'
      }
      style={props.variant === 'embedded' ? { marginTop: 24 } : undefined}
      data-testid={
        props.variant === 'embedded' ? 'settings-automation-subagents' : 'subagent-panel'
      }
    >
      {props.variant === 'embedded' ? (
        <PageTitle title={isChinese ? '任务' : 'Tasks'} />
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {overview.activeBatches.map((batch) => (
        <div
          key={batch.runId}
          className="settings-section"
          data-testid="subagent-active-batches"
        >
          <div className="subagent-tasks-batch-head">
            <h4 className="subagent-tasks-header" data-testid="subagent-tasks-header">
              {formatTasksBatchHeader(batch, localeTag)}
            </h4>
            {batch.cancellable ? (
              <Button
                size="compact"
                variant="danger"
                disabled={cancellingRunId === batch.runId}
                data-testid={`subagent-batch-cancel-${batch.runId}`}
                onClick={() => {
                  void cancelBatch(batch);
                }}
              >
                {cancellingRunId === batch.runId
                  ? (isChinese ? '停止中…' : 'Stopping…')
                  : (isChinese ? '停止批次' : 'Stop batch')}
              </Button>
            ) : null}
          </div>
          {batch.items.length > 0 ? (
            <ul className="ext-list">
              {batch.items.map((item) => (
                <TaskRow
                  key={item.anchorId}
                  item={item}
                  locale={localeTag}
                  onOpenSession={props.onOpenSession}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      {overview.recentItems.length > 0 ? (
        <div className="settings-section" data-testid="subagent-tasks-recent">
          <PageTitle title={isChinese ? '最近任务' : 'Recent tasks'} />
          <ul className="ext-list">
            {overview.recentItems.map((item) => (
              <TaskRow
                key={item.anchorId}
                item={item}
                locale={localeTag}
                onOpenSession={props.onOpenSession}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {confirmDialog.dialog}
    </div>
  );
}
