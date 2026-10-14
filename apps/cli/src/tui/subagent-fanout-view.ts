import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { firstTextLine, formatSubagentTokens, withoutSuccessVerdict } from '@piwin/host-client';
import { formatElapsed } from './status-line.js';
import { elapsedOf, SUBAGENT_ROW_ICON, type LiveSubagentRun } from './subagent-run-view.js';
import { style } from './tui-style.js';

/**
 * Terminal fan-out for two or more delegations in one assistant message
 * (the TUI side of Desktop's proto-14 fan-out):
 *
 *    ◌ 派出 3 个子代理  1 完成 · 1 运行中 · 1 失败          26k tok · 1m 03s
 *               ┌─ ✓ 实现导出接口   导出路径改走 media 目录      9.4k tok · 10s
 *      主代理 ──┼─ ◌ 审查权限改动   read permission-policy.ts  6.9k tok · 1m 03s
 *               └─ ✗ 调研缓存策略   web_fetch 超时（30s）       2.9k tok · 27s
 *
 * One line per child in every phase; branch and icon share the phase colour.
 * The main-agent label is display only. Narrow terminals drop it for a plain
 * `├ └` tree. Pure: the caller supplies live runs and the clock.
 */

/** Below this the main-agent column and token column are dropped. */
export const SUBAGENT_FANOUT_WIDE_MIN = 72;

const MAIN_LABEL = '   主代理 ──';
const TITLE_WIDTH = 18;
const EXPANDED_DETAIL_LINES = 6;

export type SubagentFanoutRow = {
  key: string;
  /** Task text the delegation tool carried; the title while the Host has not named the run. */
  task: string;
  live: LiveSubagentRun | undefined;
};

type Phase = 'queued' | 'running' | 'done' | 'pending' | 'failed' | 'cancelled';

function phaseOf(live: LiveSubagentRun | undefined): Phase {
  switch (live?.status) {
    case undefined:
    case 'queued':
      return 'queued';
    case 'starting':
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'needs-integration':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

const PAINT: Record<Phase, (text: string) => string> = {
  queued: style.gray,
  running: style.yellow,
  done: style.green,
  pending: style.yellow,
  failed: style.red,
  cancelled: style.gray,
};

/** Origin row: the middle one, the upper middle for an even count. */
export function subagentFanoutOriginRow(count: number): number {
  return Math.max(0, Math.floor((count - 1) / 2));
}

/** Box-drawing branch for row `index` of `count` in the wide layout. */
export function subagentFanoutBranch(index: number, count: number): string {
  const origin = index === subagentFanoutOriginRow(count);
  if (index === 0) return origin ? '┬─' : '┌─';
  if (index === count - 1) return '└─';
  return origin ? '┼─' : '├─';
}

function rowActivity(live: LiveSubagentRun | undefined, phase: Phase): string {
  if (live === undefined) return '已派出';
  if (phase === 'pending') return '结果待处理 · /subagents';
  if (phase === 'running') return live.step ?? live.activity;
  if (phase === 'done' && live.summary !== undefined) {
    return firstTextLine(withoutSuccessVerdict(live.summary)) || live.activity;
  }
  return firstTextLine(live.activity);
}

function rowMeta(live: LiveSubagentRun | undefined, wide: boolean, now: number): string {
  const elapsed = elapsedOf(live, now);
  const tokens = live?.totalTokens;
  return [
    wide && tokens !== undefined && tokens > 0 ? formatSubagentTokens(tokens) : undefined,
    elapsed === undefined ? undefined : formatElapsed(elapsed),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

function countsLabel(phases: readonly Phase[]): string {
  const count = (phase: Phase): number => phases.filter((candidate) => candidate === phase).length;
  return [
    [count('done') + count('pending'), '完成'],
    [count('running'), '运行中'],
    [count('queued'), '排队'],
    [count('failed'), '失败'],
    [count('cancelled'), '取消'],
    [count('pending'), '待处理'],
  ]
    .filter(([value]) => (value as number) > 0)
    .map(([value, label]) => `${value} ${label}`)
    .join(' · ');
}

/** Left and right text on one line; the left side is clipped to keep the right visible. */
function spread(left: string, right: string, width: number): string {
  if (right.length === 0) return truncateToWidth(left, width);
  const room = Math.max(1, width - visibleWidth(right) - 1);
  const head = truncateToWidth(left, room, '…', true);
  return truncateToWidth(`${head} ${right}`, width);
}

function header(rows: readonly SubagentFanoutRow[], phases: readonly Phase[], wide: boolean, now: number): [string, string] {
  const active = phases.some((phase) => phase === 'running' || phase === 'queued');
  const icon = active ? style.yellow('◌') : style.green('●');
  const spans = rows.map((row) => elapsedOf(row.live, now)).filter((span): span is number => span !== undefined);
  // A partial sum would understate the group: total tokens only when every child reported.
  const tokens = rows.every((row) => row.live?.totalTokens !== undefined)
    ? rows.reduce((sum, row) => sum + (row.live?.totalTokens ?? 0), 0)
    : undefined;
  const right = [
    wide && tokens !== undefined && tokens > 0 ? formatSubagentTokens(tokens) : undefined,
    spans.length === 0 ? undefined : formatElapsed(Math.max(...spans)),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  return [` ${icon} ${style.bold(`派出 ${rows.length} 个子代理`)}  ${style.gray(countsLabel(phases))}`, style.gray(right)];
}

function expandedDetail(live: LiveSubagentRun | undefined, phase: Phase): string[] {
  if (live === undefined) return [];
  if (phase === 'running' || phase === 'queued') return live.recentSteps ?? [];
  if (live.summary === undefined) return [];
  return withoutSuccessVerdict(live.summary).trim().split('\n').slice(0, EXPANDED_DETAIL_LINES);
}

export function renderSubagentFanout(
  rows: readonly SubagentFanoutRow[],
  width: number,
  expanded: boolean,
  now = Date.now(),
): string[] {
  const wide = width >= SUBAGENT_FANOUT_WIDE_MIN;
  const phases = rows.map((row) => phaseOf(row.live));
  const [headLeft, headRight] = header(rows, phases, wide, now);
  const lines = [spread(headLeft, headRight, width)];
  const origin = subagentFanoutOriginRow(rows.length);
  const labelPad = ' '.repeat(visibleWidth(MAIN_LABEL));
  rows.forEach((row, index) => {
    const phase = phases[index] ?? 'queued';
    const paint = PAINT[phase];
    const last = index === rows.length - 1;
    const lead = wide
      ? `${index === origin ? style.gray(MAIN_LABEL) : labelPad}${paint(subagentFanoutBranch(index, rows.length))} `
      : `   ${paint(last ? '└' : '├')} `;
    const icon = SUBAGENT_ROW_ICON[row.live?.status ?? 'queued'] ?? '·';
    const title = truncateToWidth(row.live?.title ?? firstTextLine(row.task), TITLE_WIDTH, '…', true);
    const activity = rowActivity(row.live, phase);
    const painted = phase === 'failed' ? style.red(activity) : phase === 'pending' ? style.yellow(activity) : style.gray(activity);
    lines.push(spread(`${lead}${icon} ${title}  ${painted}`, style.gray(rowMeta(row.live, wide, now)), width));
    if (!expanded) return;
    const rail = wide ? `${labelPad}${style.gray(last ? '  ' : '│ ')} ` : `   ${style.gray(last ? ' ' : '│')} `;
    for (const detail of expandedDetail(row.live, phase)) {
      lines.push(truncateToWidth(`${rail}  ${style.gray(detail)}`, width));
    }
  });
  return lines;
}
