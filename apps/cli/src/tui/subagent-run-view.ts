import { truncateToWidth } from '@earendil-works/pi-tui';
import type {
  SubagentControlDisplay,
  SubagentControlRunDisplay,
  SubagentInvocation,
  SubagentInvocationActivity,
} from '@piwin/contracts';
import { formatElapsed } from './status-line.js';
import { style } from './tui-style.js';

/** What the TUI knows live about one invocation, from `subagent/invocation-updated`. */
export type LiveSubagentRun = {
  invocationId: string;
  runId: string;
  title?: string;
  status: SubagentInvocation['status'];
  activity: string;
  startedAt: number;
  /** Set once the invocation reached a terminal status. */
  endedAt?: number;
};

const TERMINAL = new Set<SubagentInvocation['status']>(['completed', 'needs-integration', 'failed', 'cancelled']);

export function describeActivity(activity: SubagentInvocationActivity): string {
  switch (activity.kind) {
    case 'queued':
      return '排队中';
    case 'preparing':
      return '准备中';
    case 'thinking':
      return '思考中';
    case 'responding':
      return '生成中';
    case 'tool':
      return `执行工具 ${activity.title ?? activity.toolName}`;
    case 'permission':
      return `需要确认：${activity.action}`;
    case 'completed':
      return activity.summary ?? '已完成';
    case 'needs-integration':
      return activity.message ?? '结果待处理';
    case 'failed':
      return activity.message === undefined ? '失败' : `失败：${activity.message}`;
    case 'cancelled':
      return '已取消';
  }
}

export function toLiveRun(invocation: SubagentInvocation, previous?: LiveSubagentRun): LiveSubagentRun {
  const created = Date.parse(invocation.createdAt);
  const updated = Date.parse(invocation.updatedAt);
  const terminal = TERMINAL.has(invocation.status);
  return {
    invocationId: invocation.id,
    runId: invocation.runId,
    ...(invocation.title === undefined ? {} : { title: invocation.title }),
    status: invocation.status,
    activity: describeActivity(invocation.activity),
    startedAt: previous?.startedAt ?? (Number.isNaN(created) ? Date.now() : created),
    ...(terminal ? { endedAt: Number.isNaN(updated) ? Date.now() : updated } : {}),
  };
}

export type LiveRunLookup = (invocationId: string | undefined, runId: string) => LiveSubagentRun | undefined;

const ROW_ICON: Record<string, string> = {
  queued: style.gray('·'),
  starting: style.yellow('◌'),
  running: style.yellow('◌'),
  completed: style.green('✓'),
  'needs-integration': style.yellow('⚠'),
  failed: style.red('✗'),
  cancelled: style.gray('⊘'),
};

function needsDecision(run: SubagentControlRunDisplay): boolean {
  return run.integrationStatus === 'pending' || run.integrationStatus === 'conflict' || run.integrationStatus === 'failed';
}

function elapsedOf(live: LiveSubagentRun | undefined, now: number): number | undefined {
  if (live === undefined) return undefined;
  return (live.endedAt ?? now) - live.startedAt;
}

/**
 * The run tree under a subagent control tool: a header with counts, then one
 * line per run (status, title, latest activity, elapsed). Results waiting for
 * a decision say so and point at /subagents. Expanded (Ctrl+O), each run also
 * shows its summary preview.
 */
export function renderSubagentControl(
  control: SubagentControlDisplay,
  width: number,
  expanded: boolean,
  lookup: LiveRunLookup,
  now = Date.now(),
): string[] {
  if (control.phase === 'accepted') {
    const live = lookup(control.invocationId, control.runId);
    const icon = ROW_ICON[live?.status ?? 'queued'] ?? '·';
    const elapsed = elapsedOf(live, now);
    const detail = [live?.activity ?? '已派出', elapsed === undefined ? undefined : formatElapsed(elapsed)]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
    const task = control.task.replace(/\s+/g, ' ').trim();
    return [
      truncateToWidth(`   └ ${icon} ${live?.title ?? task} ${style.gray(detail)}`, width),
      ...(expanded && live?.title !== undefined ? [truncateToWidth(`     ${style.gray(task)}`, width)] : []),
    ];
  }
  const runs = control.runs;
  const lives = runs.map((run) => lookup(run.invocationId, run.runId));
  const spans = lives.map((live) => elapsedOf(live, now)).filter((span): span is number => span !== undefined);
  const elapsed = spans.length === 0 ? '' : ` · ${formatElapsed(Math.max(...spans))}`;
  const lines: string[] = [];
  if (control.phase === 'cancelling' || control.phase === 'cancelled') {
    lines.push(truncateToWidth(`   ${style.gray(`子代理 ×${control.total} · 已取消 ${control.cancelled}${control.phase === 'cancelling' ? ' · 取消中' : ''}`)}`, width));
  } else {
    const waiting = control as Extract<SubagentControlDisplay, { phase: 'waiting' | 'waited' }>;
    const running = waiting.total - waiting.completed - waiting.failed - control.cancelled;
    const counts = [
      `${waiting.completed} 完成`,
      running > 0 ? `${running} 运行中` : undefined,
      waiting.failed > 0 ? `${waiting.failed} 失败` : undefined,
      control.cancelled > 0 ? `${control.cancelled} 取消` : undefined,
      waiting.needsIntegration > 0 ? `${waiting.needsIntegration} 待处理` : undefined,
    ].filter((part): part is string => part !== undefined);
    lines.push(truncateToWidth(`   ${style.gray(`子代理 ×${control.total} (${counts.join(' · ')})${elapsed}`)}`, width));
  }
  runs.forEach((run, index) => {
    const live = lives[index];
    const branch = index === runs.length - 1 ? '└' : '├';
    const pending = needsDecision(run);
    const status = pending ? 'needs-integration' : (live?.status ?? run.executionStatus);
    const icon = ROW_ICON[status] ?? '·';
    const title = run.title ?? live?.title ?? run.runId.slice(0, 8);
    const runElapsed = elapsedOf(live, now);
    const activity = pending
      ? style.yellow('结果待处理 · /subagents')
      : style.gray(live?.activity ?? run.activity ?? run.summaryPreview ?? '');
    const tail = runElapsed === undefined ? '' : style.gray(` · ${formatElapsed(runElapsed)}`);
    lines.push(truncateToWidth(`   ${style.gray(branch)} ${icon} ${title}  ${activity}${tail}`, width));
    if (expanded && run.summaryPreview !== undefined && run.summaryPreview.trim().length > 0) {
      const continuation = index === runs.length - 1 ? ' ' : '│';
      for (const line of run.summaryPreview.trim().split('\n').slice(0, 6)) {
        lines.push(truncateToWidth(`   ${style.gray(continuation)}   ${style.gray(line)}`, width));
      }
    }
  });
  if (!expanded && runs.some((run) => run.summaryPreview !== undefined)) {
    lines.push(truncateToWidth(`   ${style.gray('Ctrl+O 展开摘要')}`, width));
  }
  return lines;
}
