import type {
  DesktopMemoryDiagnostics,
  DesktopMemoryPressureSample,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

/** Last N native samples rendered in the `/memory` report. */
const REPORT_SAMPLE_LIMIT = 8;

export type TuiMemoryControllerOptions = {
  modals: TuiModalStack;
  /** `link.request` — `desktop/memory-diagnostics` answers with the stored bundle. */
  request: (command: HostCommand) => Promise<HostResponse>;
  onError: (error: unknown) => void;
};

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return 'n/a';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function describeSample(sample: DesktopMemoryPressureSample): string {
  const id = sample.sampleId === undefined ? '?' : `#${sample.sampleId}`;
  const quality = sample.quality ?? '?';
  const main = formatBytes(sample.bytes ?? sample.aggregateFootprintBytes);
  const os = sample.osPressure ?? 'n/a';
  const parts = [`${id} ${quality} 主进程 ${main} 系统压力 ${os}`];
  if (sample.unknownWindows !== undefined && sample.unknownWindows.length > 0) {
    parts.push(`未知窗口 ${sample.unknownWindows.join(',')}`);
  }
  if (sample.errors !== undefined && sample.errors.length > 0) {
    parts.push(`错误 ${sample.errors.length}`);
  }
  return parts.join(' · ');
}

/** Lines of the `/memory` report. Payload-free: counts, ids and byte gauges. */
export function formatDesktopMemoryDiagnostics(diagnostics: DesktopMemoryDiagnostics): string[] {
  const { snapshot } = diagnostics;
  const lines: string[] = [];
  const capturedAt = new Date(diagnostics.capturedAtMs);
  lines.push(`采集时间  ${Number.isNaN(capturedAt.getTime()) ? '未知' : capturedAt.toLocaleTimeString()}`);
  lines.push(
    `待确认样本  ${snapshot.pendingSampleId === undefined ? '无' : `#${snapshot.pendingSampleId}`} · ` +
      `停滞 tick ${snapshot.stalledTicks} · ` +
      `已清理事件 ${snapshot.purgeResults.length}`,
  );
  const samples = snapshot.samples;
  lines.push('', `最近样本（共 ${samples.length}，显示至多 ${REPORT_SAMPLE_LIMIT} 条）`);
  if (samples.length === 0) {
    lines.push('  暂无');
  } else {
    for (const sample of samples.slice(-REPORT_SAMPLE_LIMIT)) {
      lines.push(`  ${describeSample(sample)}`);
    }
  }
  const purges = snapshot.purgeResults;
  if (purges.length > 0) {
    const counts = new Map<string, number>();
    for (const purge of purges) {
      counts.set(purge.status, (counts.get(purge.status) ?? 0) + 1);
    }
    lines.push('', `清理历史  ${[...counts.entries()].map(([status, n]) => `${status} ×${n}`).join(' · ')}`);
  }
  const frontend = diagnostics.frontend;
  if (frontend !== undefined) {
    lines.push('', '渲染侧指标');
    if (frontend.renderCommits !== undefined) {
      lines.push(`  render commits ${frontend.renderCommits}`);
    }
    if (frontend.clientQueueHighWater !== undefined) {
      lines.push(
        `  队列高水位 ${frontend.clientQueueHighWater.items} 条 / ${formatBytes(frontend.clientQueueHighWater.bytes)}`,
      );
    }
    const dom = frontend.domMetrics;
    if (dom !== undefined && typeof dom.mountedTranscriptItems === 'number') {
      lines.push(`  DOM 已挂载消息 ${dom.mountedTranscriptItems} · 代码行 ${dom.mountedCodeLines ?? 0}`);
    }
  }
  return lines;
}

/** `/memory`: the desktop-reported memory diagnostics bundle, or its absence. */
export class TuiMemoryController {
  public constructor(private readonly options: TuiMemoryControllerOptions) {}

  public async open(): Promise<void> {
    let response: HostResponse;
    try {
      response = await this.options.request({ type: 'desktop/memory-diagnostics' });
    } catch (error) {
      this.options.onError(error);
      return;
    }
    const lines = !response.success
      ? [`读取失败：${response.error}`]
      : response.data == null
        ? ['no desktop memory report yet (desktop not attached or reporter not running)']
        : formatDesktopMemoryDiagnostics(response.data as DesktopMemoryDiagnostics);
    const { modals } = this.options;
    modals.show(new ViewerOverlay({ title: '内存诊断', lines, onClose: () => modals.close() }));
  }
}
