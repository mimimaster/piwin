import type { AgentEvent, UsageFirstTokenKind } from '@piwin/contracts';

/** Host-observed turn timing for adapters that report aggregate usage without TTFT. */
export class AgentPluginTurnTiming {
  private startedAtMs: number | undefined;
  private firstTokenMs: number | undefined;
  private firstTokenKind: UsageFirstTokenKind | undefined;
  private runId: string | undefined;

  constructor(private readonly nowMs: () => number = () => performance.now()) {}

  begin(runId: string): void {
    this.startedAtMs = this.nowMs();
    this.firstTokenMs = undefined;
    this.firstTokenKind = undefined;
    this.runId = runId;
  }

  end(): void {
    this.startedAtMs = undefined;
    this.firstTokenMs = undefined;
    this.firstTokenKind = undefined;
    this.runId = undefined;
  }

  /** Observe before async media imports/projection so they cannot inflate latency. */
  observe(event: AgentEvent): AgentEvent {
    if (this.startedAtMs === undefined) return event;
    const eventRunId = event.type === 'usage/finalized'
      ? event.measurement.runId
      : 'runId' in event ? event.runId : undefined;
    if (eventRunId !== undefined && eventRunId !== this.runId) return event;
    const elapsedMs = Math.max(0, this.nowMs() - this.startedAtMs);
    if (!Number.isFinite(elapsedMs)) return event;
    if (this.firstTokenMs === undefined) {
      const firstTokenKind = readModelContentKind(event);
      if (firstTokenKind !== undefined) {
        this.firstTokenMs = elapsedMs;
        this.firstTokenKind = firstTokenKind;
      }
    }
    if (event.type !== 'usage/finalized' || event.measurement.firstTokenMs !== undefined) {
      return event;
    }
    // A provider's API duration and Host TTFT can cover different spans. Keep
    // the pair on one clock, and expose its turn scope instead of implying decode speed.
    return {
      ...event,
      measurement: {
        ...event.measurement,
        durationMs: elapsedMs,
        ...(this.firstTokenMs !== undefined ? { firstTokenMs: this.firstTokenMs } : {}),
        ...(this.firstTokenKind !== undefined ? { firstTokenKind: this.firstTokenKind } : {}),
        timingScope: 'turn',
      },
    };
  }
}

function readModelContentKind(event: AgentEvent): UsageFirstTokenKind | undefined {
  switch (event.type) {
    case 'message/thinking_delta':
      return event.delta.length > 0 ? 'reasoning' : undefined;
    case 'message/text_delta':
      return event.delta.length > 0 ? 'content' : undefined;
    case 'message/text_snapshot':
      return event.text.length > 0 ? 'content' : undefined;
    case 'tool/start':
      return 'content';
    default:
      return undefined;
  }
}
