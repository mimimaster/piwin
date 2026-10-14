import { truncateToWidth } from '@earendil-works/pi-tui';
import type {
  SubagentControlDisplay,
  SubagentControlRunDisplay,
  SubagentInvocation,
  SubagentInvocationActivity,
} from '@piwin/contracts';
import { formatElapsed } from './status-line.js';
import { style } from './tui-style.js';

/**
 * What the TUI knows live about one invocation: Host facts from
 * `subagent/invocation-updated`, plus the step the child is on from
 * `subagent/stream` (`step`, `recentSteps`), which the push never carries.
 */
export type LiveSubagentRun = {
  invocationId: string;
  runId: string;
  /** The delegation tool call that created it; anchors `piwin_subagent_run` rows. */
  parentToolCallId?: string;
  childSessionId?: string;
  title?: string;
  task: string;
  status: SubagentInvocation['status'];
  activity: string;
  /** Host-measured counters; absent on older Hosts. */
  toolCalls?: number;
  totalTokens?: number;
  /** Full report preview once completed (Ctrl+O shows it under the row). */
  summary?: string;
  /** The child's running tool as a step line (`read src/a.ts`), from the stream. */
  step?: string;
  /** Last few step lines, newest last, from the stream. */
  recentSteps?: string[];
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
  const usage = invocation.usage;
  const summary =
    invocation.activity.kind === 'completed'
      ? invocation.activity.summary
      : invocation.activity.kind === 'needs-integration'
        ? invocation.activity.message
        : undefined;
  return {
    invocationId: invocation.id,
    runId: invocation.runId,
    ...(invocation.parentToolCallId === undefined ? {} : { parentToolCallId: invocation.parentToolCallId }),
    ...(invocation.childSessionId === undefined ? {} : { childSessionId: invocation.childSessionId }),
    ...(invocation.title === undefined ? {} : { title: invocation.title }),
    task: invocation.task,
    status: invocation.status,
    activity: describeActivity(invocation.activity),
    ...(usage === undefined ? {} : { toolCalls: usage.toolCalls, totalTokens: usage.totalTokens }),
    ...(summary === undefined || summary.trim().length === 0 ? {} : { summary: summary.trim() }),
    // Stream-owned: an invocation push must not wipe the step the child is on.
    ...(terminal || previous?.step === undefined ? {} : { step: previous.step }),
    ...(previous?.recentSteps === undefined ? {} : { recentSteps: previous.recentSteps }),
    startedAt: previous?.startedAt ?? (Number.isNaN(created) ? Date.now() : created),
    ...(terminal ? { endedAt: Number.isNaN(updated) ? Date.now() : updated } : {}),
  };
}

export type LiveRunLookup = (invocationId: string | undefined, runId: string) => LiveSubagentRun | undefined;

export const SUBAGENT_ROW_ICON: Record<string, string> = {
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

export function elapsedOf(live: LiveSubagentRun | undefined, now: number): number | undefined {
  if (live === undefined) return undefined;
  return (live.endedAt ?? now) - live.startedAt;
}

/**
 * A lone delegation (`start` accepted, or a synchronous `run`): one `└` row
 * under its tool line with the live step and elapsed time.
 */
export function renderSubagentSingleRow(
  live: LiveSubagentRun | undefined,
  taskText: string,
  width: number,
  expanded: boolean,
  now = Date.now(),
): string[] {
  const icon = SUBAGENT_ROW_ICON[live?.status ?? 'queued'] ?? '·';
  const elapsed = elapsedOf(live, now);
  const running = live?.endedAt === undefined;
  const activity = (running ? live?.step : undefined) ?? live?.activity ?? '已派出';
  const detail = [activity, elapsed === undefined ? undefined : formatElapsed(elapsed)]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  const task = taskText.replace(/\s+/g, ' ').trim();
  return [
    truncateToWidth(`   └ ${icon} ${live?.title ?? task} ${style.gray(detail)}`, width),
    ...(expanded && live?.title !== undefined ? [truncateToWidth(`     ${style.gray(task)}`, width)] : []),
  ];
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
    return renderSubagentSingleRow(lookup(control.invocationId, control.runId), control.task, width, expanded, now);
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
    const icon = SUBAGENT_ROW_ICON[status] ?? '·';
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
