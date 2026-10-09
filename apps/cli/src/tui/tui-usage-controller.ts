import type { HostPush, SessionContextSnapshot } from '@piwin/contracts';
import { buildContextReport, type RequestUsage } from './context-report.js';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

export type TuiUsageControllerOptions = {
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  getContext: () => SessionContextSnapshot | undefined;
  describeModel: () => { model: string; thinking?: string };
};

/** `/context`: how full the window is and what the last request cost. */
export class TuiUsageController {
  private lastRequest: RequestUsage | null = null;

  public constructor(private readonly options: TuiUsageControllerOptions) {}

  /** A session was opened: its last request comes with the resume payload. */
  public reset(lastRequest: RequestUsage | null): void {
    this.lastRequest = lastRequest;
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
