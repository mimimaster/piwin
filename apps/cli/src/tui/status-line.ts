import type { SessionRunPhase } from '@piwin/contracts';
import { truncateToWidth, type Component } from '@earendil-works/pi-tui';

const ANSI = /\x1b\[[0-9;]*m/g;

export type StatusLineContent = {
  /** What needs attention; drawn on its own line above the status line. */
  alerts: readonly string[];
  /** The status line for a width (it picks its tier and drops fields to fit). */
  line: (width: number) => string;
};

/** Footer under the editor: an optional alerts line, then the status line. Clipped, never wrapped. */
export class StatusLine implements Component {
  private content: StatusLineContent = { alerts: [], line: () => '' };
  private lastWidth = 120;

  public setText(text: string): void {
    this.content = { alerts: [], line: () => text };
  }

  public setContent(content: StatusLineContent): void {
    this.content = content;
  }

  /** Both lines as plain text, at the last drawn width. */
  public getText(): string {
    return [...this.content.alerts, this.content.line(this.lastWidth - 1)].filter((part) => part.length > 0).join(' · ').replace(ANSI, '');
  }

  public invalidate(): void {
    // Stateless between frames: nothing cached.
  }

  public render(width: number): string[] {
    this.lastWidth = width;
    const lines: string[] = [];
    if (this.content.alerts.length > 0) lines.push(truncateToWidth(` ${this.content.alerts.join(' · ')}`, width));
    lines.push(truncateToWidth(` ${this.content.line(Math.max(1, width - 1))}`, width));
    return lines;
  }
}

const RUN_PHASE_LABEL: Record<SessionRunPhase, string> = {
  accepted: '已接收',
  preparing: '准备中',
  'connecting-model': '连接模型',
  'waiting-first-token': '等待回复',
  streaming: '生成中',
  'tool-running': '执行工具',
  'waiting-permission': '等待确认',
  pausing: '暂停中',
  cancelling: '中断中',
  'waiting-resource': '等待资源',
  'waiting-subagents': '等待子代理',
};

/** What the activity line says a running turn is doing. */
export function describeRunPhase(phase: string | undefined): string {
  // A newer Host may report a phase this shell has no word for yet.
  return (RUN_PHASE_LABEL as Record<string, string | undefined>)[phase ?? ''] ?? '运行中';
}

/** Elapsed time of a running turn: `12s`, then `1m 05s`, then `1h 02m`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
