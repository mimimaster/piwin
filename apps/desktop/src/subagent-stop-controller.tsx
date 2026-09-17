/**
 * User stop for subagent batches from shell controls: the composer activity
 * pill and running transcript cards. One controller per workbench keeps
 * confirmation, pending state, and failure reporting identical for both, and
 * the transcript reads it from context instead of threading props through
 * every row component (same precedent as subagent-inspector-context).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { showErrorNotification, showWarningNotification } from '@piwin/ui-kit';
import { isOrchestrationExecutionActive } from './subagent-activity-model.js';
import type { SubagentOrchestrationItem } from './subagent-orchestration-view.js';
import { batchNeedsCancelConfirm } from './subagent-tasks-overview.js';
import { useConfirmDialog } from './use-confirm-dialog';

export type SubagentStopController = {
  /** Stop one batch; confirms first when that would drop work or siblings. */
  stop: (runId: string) => Promise<void>;
  /** Stop several batches behind at most one confirmation. */
  stopMany: (runIds: readonly string[]) => Promise<void>;
  isStopping: (runId: string) => boolean;
  /** Running tasks in the batch; above one, stopping a row stops them all. */
  activeTaskCount: (runId: string) => number;
  dialog: ReactElement | null;
};

type StopCopy = {
  title: (count: number) => string;
  integrationDescription: string;
  siblingsDescription: (count: number) => string;
  confirm: string;
  cancel: string;
  failed: string;
  detached: string;
};

function stopCopy(locale: 'zh-CN' | 'en'): StopCopy {
  if (locale === 'en') {
    return {
      title: (count) => (count > 1 ? `Stop ${count} subagent batches?` : 'Stop this subagent?'),
      integrationDescription:
        'Changes are still awaiting integration. Stopping may leave them unapplied.',
      siblingsDescription: (count) =>
        `This batch has ${count} running tasks; stopping it stops all of them.`,
      confirm: 'Stop',
      cancel: 'Cancel',
      failed: 'Could not stop subagent',
      detached: 'The subagent did not respond to stop in time and was detached.',
    };
  }
  return {
    title: (count) => (count > 1 ? `停止 ${count} 个子任务批次？` : '停止这个子任务？'),
    integrationDescription: '有改动尚未合入。停止后这些改动可能无法继续处理。',
    siblingsDescription: (count) => `这个批次有 ${count} 个运行中的任务，停止会一起停掉。`,
    confirm: '停止',
    cancel: '取消',
    failed: '无法停止子任务',
    detached: '子任务没有及时响应停止，已强制脱离。',
  };
}

function readCancelStatus(response: HostResponse): string | undefined {
  if (!response.success) return undefined;
  const data = response.data as { status?: unknown } | undefined;
  return typeof data?.status === 'string' ? data.status : undefined;
}

export function useSubagentStopController(input: {
  request: (command: HostCommand) => Promise<HostResponse>;
  items: readonly SubagentOrchestrationItem[];
  locale: 'zh-CN' | 'en';
}): SubagentStopController {
  const { request, items, locale } = input;
  const confirmDialog = useConfirmDialog();
  const { confirm } = confirmDialog;
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set());

  const activeTaskCount = useCallback(
    (runId: string): number =>
      items.filter(
        (item) => item.runId === runId && isOrchestrationExecutionActive(item.executionStatus),
      ).length,
    [items],
  );

  const cancelOne = useCallback(
    async (runId: string): Promise<void> => {
      const copy = stopCopy(locale);
      setStopping((current) => new Set(current).add(runId));
      try {
        const response = await request({ type: 'subagent/batch-cancel', runId });
        if (!response.success) {
          showErrorNotification(response.error, copy.failed);
        } else if (readCancelStatus(response) === 'detached') {
          showWarningNotification(copy.detached);
        }
      } catch (error) {
        showErrorNotification(formatError(error), copy.failed);
      } finally {
        setStopping((current) => {
          const next = new Set(current);
          next.delete(runId);
          return next;
        });
      }
    },
    [locale, request],
  );

  const stopMany = useCallback(
    async (runIds: readonly string[]): Promise<void> => {
      const targets = [...new Set(runIds)].filter((runId) => !stopping.has(runId));
      if (targets.length === 0) return;
      const copy = stopCopy(locale);
      const batchItems = items.filter(
        (item) => item.runId !== undefined && targets.includes(item.runId),
      );
      const needsIntegrationConfirm = batchNeedsCancelConfirm(batchItems);
      const siblingCount =
        targets.length === 1 ? activeTaskCount(targets[0] as string) : 0;
      if (needsIntegrationConfirm || siblingCount > 1) {
        const confirmed = await confirm({
          title: copy.title(targets.length),
          description: needsIntegrationConfirm
            ? copy.integrationDescription
            : copy.siblingsDescription(siblingCount),
          confirmLabel: copy.confirm,
          cancelLabel: copy.cancel,
          tone: 'danger',
        });
        if (!confirmed) return;
      }
      await Promise.all(targets.map((runId) => cancelOne(runId)));
    },
    [activeTaskCount, cancelOne, confirm, items, locale, stopping],
  );

  const stop = useCallback((runId: string) => stopMany([runId]), [stopMany]);
  const isStopping = useCallback((runId: string) => stopping.has(runId), [stopping]);

  return useMemo(
    () => ({
      stop,
      stopMany,
      isStopping,
      activeTaskCount,
      dialog: confirmDialog.dialog,
    }),
    [activeTaskCount, confirmDialog.dialog, isStopping, stop, stopMany],
  );
}

const SubagentStopContext = createContext<SubagentStopController | null>(null);

export function SubagentStopProvider(props: {
  value: SubagentStopController | null;
  children: ReactNode;
}): ReactElement {
  return (
    <SubagentStopContext.Provider value={props.value}>
      {props.children}
    </SubagentStopContext.Provider>
  );
}

/** Null outside the provider (tests, nested child transcripts) — cards stay read-only. */
export function useSubagentStop(): SubagentStopController | null {
  return useContext(SubagentStopContext);
}
