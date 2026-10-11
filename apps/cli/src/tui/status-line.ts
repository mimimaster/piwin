import type { SessionRunPhase } from '@piwin/contracts';
import { truncateToWidth, type Component } from '@earendil-works/pi-tui';

/** One-line footer under the editor; clipped, never wrapped. */
export class StatusLine implements Component {
  private text = '';

  public setText(text: string): void {
    this.text = text;
  }

  public invalidate(): void {
    // Stateless between frames: nothing cached.
  }

  public render(width: number): string[] {
    return [truncateToWidth(` ${this.text}`, width)];
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
