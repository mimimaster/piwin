import { randomUUID } from 'node:crypto';
import type { HostPush, RunInterventionRecord, UserInstructionPayload } from '@piwin/contracts';
import { describePromptExtras } from './queued-turns.js';
import { isInterventionShown } from './queue-strip.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';

export type TuiInterventionTrackerOptions = {
  link: TuiHostLink;
  getSessionId: () => string | undefined;
  getRunId: () => string | undefined;
  onChanged: () => void;
  onHint: (text: string) => void;
  onError: (error: unknown) => void;
  /** An instruction reached the model: it belongs in the transcript now. */
  onApplied: (intervention: RunInterventionRecord, annotations: string[]) => void;
  /** Queue a failed instruction as the next turn instead. */
  requeue: (sessionId: string, input: UserInstructionPayload) => Promise<number>;
};

/** Fold one record in; an older revision never undoes a newer one. */
export function applyIntervention(
  list: readonly RunInterventionRecord[],
  record: RunInterventionRecord,
): RunInterventionRecord[] {
  const existing = list.find((entry) => entry.interventionId === record.interventionId);
  if (existing !== undefined && existing.revision > record.revision) return [...list];
  const others = list.filter((entry) => entry.interventionId !== record.interventionId);
  const next = isInterventionShown(record.status) ? [...others, record] : others;
  return next.sort((left, right) => left.sequence - right.sequence);
}

/**
 * Steers addressed to the running turn (`run/intervention-*`). They stay in
 * the strip above the composer until the Host says they reached the model;
 * only then are they written into the transcript, marked 已插入.
 */
export class TuiInterventionTracker {
  private interventions: RunInterventionRecord[] = [];
  private readonly applied = new Set<string>();

  public constructor(private readonly options: TuiInterventionTrackerOptions) {}

  public list(): readonly RunInterventionRecord[] {
    return this.interventions;
  }

  public reset(): void {
    this.interventions = [];
    this.applied.clear();
  }

  public handlePush(push: HostPush): boolean {
    if (push.type !== 'run/intervention-updated') return false;
    if (push.intervention.sessionId !== this.options.getSessionId()) return true;
    this.apply(push.intervention);
    return true;
  }

  /** Send an instruction into the running turn; it shows in the strip until applied. */
  public async submit(input: UserInstructionPayload): Promise<boolean> {
    const sessionId = this.options.getSessionId();
    const runId = this.options.getRunId();
    if (sessionId === undefined || runId === undefined) {
      this.options.onHint('没有正在运行的回合，直接发送即可');
      return false;
    }
    const data = hostData<{ intervention?: RunInterventionRecord }>(
      await this.options.link.request({
        type: 'run/intervention-submit',
        sessionId,
        runId,
        interventionId: randomUUID(),
        userMessageId: randomUUID(),
        input,
      }),
    );
    if (data.intervention !== undefined) this.apply(data.intervention);
    return true;
  }

  /** Adopt a record the Host returned for another command (queue → steer). */
  public adopt(record: RunInterventionRecord | undefined): void {
    if (record !== undefined) this.apply(record);
  }

  public async cancel(intervention: RunInterventionRecord): Promise<void> {
    if (intervention.status !== 'pending') {
      this.dismiss(intervention);
      return;
    }
    const data = hostData<{ intervention?: RunInterventionRecord }>(
      await this.options.link.request({
        type: 'run/intervention-cancel',
        sessionId: intervention.sessionId,
        runId: intervention.runId,
        interventionId: intervention.interventionId,
        expectedRevision: intervention.revision,
      }),
    );
    if (data.intervention !== undefined) this.apply(data.intervention);
    else this.dismiss(intervention);
  }

  /** A failed or expired steer becomes the next queued turn. */
  public async requeue(intervention: RunInterventionRecord): Promise<void> {
    const place = await this.options.requeue(intervention.sessionId, intervention.input);
    this.dismiss(intervention);
    this.options.onHint(`已改为排队（第 ${place} 条）`);
  }

  public dismiss(intervention: RunInterventionRecord): void {
    this.interventions = this.interventions.filter((entry) => entry.interventionId !== intervention.interventionId);
    this.options.onChanged();
  }

  private apply(record: RunInterventionRecord): void {
    this.interventions = applyIntervention(this.interventions, record);
    if (record.status === 'applied' && !this.applied.has(record.interventionId)) {
      this.applied.add(record.interventionId);
      this.options.onApplied(record, [...describePromptExtras({ ...record.input }), '已插入']);
    }
    this.options.onChanged();
  }
}
