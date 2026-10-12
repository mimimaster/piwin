import {
  buildStatusMetrics,
  type HostCommand,
  type HostPush,
  type HostResponse,
  type SessionContextSnapshot,
  type SessionUsageTotals,
  type StatusMetrics,
} from '@piwin/contracts';
import { buildContextReport, type RequestUsage } from './context-report.js';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

export type TuiUsageControllerOptions = {
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  getContext: () => SessionContextSnapshot | undefined;
  describeModel: () => { model: string; thinking?: string };
  /** Reads `usage/get-session` for the status line's session totals. */
  request?: (command: HostCommand) => Promise<HostResponse>;
  /** Totals changed: redraw the status line. */
  onChanged?: () => void;
};

const TOTALS_REFRESH_DEBOUNCE_MS = 300;

/** `/context`: how full the window is and what the last request cost. */
export class TuiUsageController {
  private lastRequest: RequestUsage | null = null;
  private totals: SessionUsageTotals | null = null;
  private totalsTimer: ReturnType<typeof setTimeout> | undefined;
  private totalsEpoch = 0;

  public constructor(private readonly options: TuiUsageControllerOptions) {}

  /** A session was opened: its last request comes with the resume payload. */
  public reset(lastRequest: RequestUsage | null): void {
    this.lastRequest = lastRequest;
    this.totals = null;
    this.totalsEpoch += 1;
    if (this.totalsTimer !== undefined) clearTimeout(this.totalsTimer);
    this.totalsTimer = undefined;
    void this.loadTotals();
  }

  /** What the status line draws: first-token latency, speed, tokens, cost, context. */
  public metrics(): StatusMetrics {
    const occupancy = this.options.getContext()?.occupancy;
    return buildStatusMetrics({
      totals: this.totals,
      lastRequest: this.lastRequest,
      ...(occupancy?.kind === 'known' && occupancy.tokensLimit !== undefined
        ? { context: { tokensUsed: occupancy.tokensUsed, tokensLimit: occupancy.tokensLimit, estimated: occupancy.quality !== 'measured' } }
        : {}),
    });
  }

  public dispose(): void {
    if (this.totalsTimer !== undefined) clearTimeout(this.totalsTimer);
    this.totalsTimer = undefined;
    this.totalsEpoch += 1;
  }

  private async loadTotals(): Promise<void> {
    const sessionId = this.options.getSessionId();
    const request = this.options.request;
    if (sessionId === undefined || request === undefined) return;
    const epoch = this.totalsEpoch;
    try {
      const response = await request({ type: 'usage/get-session', sessionId });
      if (epoch !== this.totalsEpoch || !response.success) return;
      const totals = (response.data as { totals?: SessionUsageTotals } | undefined)?.totals;
      if (totals?.sessionId !== sessionId) return;
      this.totals = totals;
      this.options.onChanged?.();
    } catch {
      // Stats are decoration; a failed read keeps the last value.
    }
  }

  private scheduleTotals(): void {
    if (this.options.request === undefined) return;
    if (this.totalsTimer !== undefined) clearTimeout(this.totalsTimer);
    this.totalsTimer = setTimeout(() => {
      this.totalsTimer = undefined;
      void this.loadTotals();
    }, TOTALS_REFRESH_DEBOUNCE_MS);
    this.totalsTimer.unref?.();
  }

  /**
   * Only observes: the push still reaches the transcript, so this never claims
   * it. Finished requests are not pushed to shells; the usage updates a
   * request streams are, and the last one is what the report shows.
   */
  public handlePush(push: HostPush): boolean {
    if (push.type !== 'event' || push.event.type !== 'usage/update') return false;
    if (push.event.sessionId !== this.options.getSessionId()) return false;
    this.lastRequest = push.event.usage;
    this.scheduleTotals();
    return false;
  }

  public open(): void {
    const context = this.options.getContext();
    const lines = buildContextReport({
      occupancy: context?.occupancy,
      ...(context === undefined ? {} : { phase: context.phase }),
      lastRequest: this.lastRequest,
      ...this.options.describeModel(),
    });
    const { modals } = this.options;
    modals.show(new ViewerOverlay({ title: '上下文与用量', lines, onClose: () => modals.close() }));
  }
}
