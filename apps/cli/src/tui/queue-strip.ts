import { truncateToWidth, type Component } from '@earendil-works/pi-tui';
import type { QueuedTurnRecord, RunInterventionRecord } from '@piwin/contracts';
import { style } from './tui-style.js';

/**
 * The strip above the composer: messages waiting for the next turn and
 * instructions on their way into the running one. Pure rows plus a small
 * component; the controllers own the Host side.
 */

export const STRIP_MAX_ROWS = 3;
const TEXT_WIDTH = 60;

export type StripRow =
  | { kind: 'queued'; key: string; turn: QueuedTurnRecord; line: string }
  | { kind: 'intervention'; key: string; intervention: RunInterventionRecord; line: string; failed: boolean };

const INTERVENTION_STATUS: Record<string, string> = {
  pending: '等待',
  applying: '插入中',
  expired: '已过期',
  failed: '失败',
  uncertain: '结果未知',
};

/** Statuses a steer row stays visible for; `applied` and `cancelled` leave the strip. */
export function isInterventionShown(status: RunInterventionRecord['status']): boolean {
  return status !== 'applied' && status !== 'cancelled';
}

export function isInterventionFailed(status: RunInterventionRecord['status']): boolean {
  return status === 'expired' || status === 'failed' || status === 'uncertain';
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length === 0 ? '（无文字）' : truncateToWidth(flat, TEXT_WIDTH, '…').replace(/\x1b\[[0-9;]*m/g, '');
}

function attachmentNote(count: number): string {
  return count === 0 ? '' : ` [附件 ${count}]`;
}

/** Steers first (they act on the running turn), then the queue in order. */
export function stripRows(
  pending: readonly QueuedTurnRecord[],
  interventions: readonly RunInterventionRecord[],
): StripRow[] {
  const steers: StripRow[] = interventions
    .filter((intervention) => isInterventionShown(intervention.status))
    .map((intervention) => {
      const failed = isInterventionFailed(intervention.status);
      const status = INTERVENTION_STATUS[intervention.status] ?? intervention.status;
      return {
        kind: 'intervention',
        key: `i:${intervention.interventionId}`,
        intervention,
        failed,
        line: `↳ 插入中: ${preview(intervention.input.text)}${attachmentNote(intervention.input.attachments?.length ?? 0)} (${status})`,
      };
    });
  let place = 0;
  const queued: StripRow[] = pending.map((turn) => {
    const extras = attachmentNote(turn.input.attachments?.length ?? 0);
    const line =
      turn.mode === 'replace'
        ? `⇄ 替换当前回合: ${preview(turn.input.text)}${extras}`
        : `⏳ 已排队 ${(place += 1)}: ${preview(turn.input.text)}${extras}`;
    return { kind: 'queued', key: `q:${turn.queuedTurnId}`, turn, line };
  });
  return [...steers, ...queued];
}

/** Keys the focused strip offers for a row. */
export function stripRowHint(row: StripRow | undefined): string {
  if (row === undefined) return '';
  if (row.kind === 'intervention') return row.failed ? 'Enter 重发为排队 · Del 移除 · Esc 返回' : 'Del 取消 · Esc 返回';
  return 'Enter 现在插入 · E 取回编辑 · Del 取消 · Esc 返回';
}

/** The visible rows: up to three around the selection, then `… 还有 N 条`. */
export function renderStrip(
  rows: readonly StripRow[],
  width: number,
  focus: { focused: boolean; selected: number },
): string[] {
  if (rows.length === 0) return [];
  const start =
    focus.focused && focus.selected >= STRIP_MAX_ROWS ? focus.selected - STRIP_MAX_ROWS + 1 : 0;
  const shown = rows.slice(start, start + STRIP_MAX_ROWS);
  const lines = shown.map((row, offset) => {
    const index = start + offset;
    const selected = focus.focused && index === focus.selected;
    const marker = selected ? style.cyan('› ') : '  ';
    const text = row.kind === 'intervention' && row.failed ? style.red(row.line) : row.kind === 'intervention' ? row.line : style.gray(row.line);
    return truncateToWidth(marker + (selected ? style.bold(text) : text), width, '…');
  });
  const hidden = rows.length - start - shown.length;
  if (hidden > 0) lines.push(truncateToWidth(style.gray(`  … 还有 ${hidden} 条`), width));
  if (focus.focused) lines.push(truncateToWidth(style.gray(`  ${stripRowHint(rows[focus.selected])}`), width));
  else lines.push(truncateToWidth(style.gray('  Alt+↑ 管理'), width));
  return lines;
}

/** Rows come from the controllers each frame; focus lives here. */
export class QueueStrip implements Component {
  public focused = false;
  public selected = 0;

  public constructor(private readonly rows: () => StripRow[]) {}

  public invalidate(): void {}

  public current(): StripRow | undefined {
    const rows = this.rows();
    if (this.selected >= rows.length) this.selected = Math.max(0, rows.length - 1);
    return rows[this.selected];
  }

  public move(delta: number): void {
    const count = this.rows().length;
    if (count === 0) return;
    this.selected = (this.selected + delta + count) % count;
  }

  public render(width: number): string[] {
    const rows = this.rows();
    if (rows.length === 0) this.focused = false;
    if (this.selected >= rows.length) this.selected = Math.max(0, rows.length - 1);
    return renderStrip(rows, width, { focused: this.focused, selected: this.selected });
  }
}
