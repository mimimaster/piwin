/**
 * Route Grok `session/update` notifications for one session (ADR 0082):
 * live turn projection, `session/load` replay buffering, and idle-time
 * signals (title, mode, commands, config). Owns the active projector.
 */

import { randomUUID } from 'node:crypto';
import {
  GrokTurnProjector,
  type GrokSessionOptionsState,
  type GrokSessionSignal,
} from '@piwin/acp-agent';
import type { AgentEvent } from '@piwin/contracts';

export type GrokNotificationSink = {
  emitAll: (events: readonly AgentEvent[]) => void;
  onTitle: (title: string) => void;
  publishOptions: () => void;
  now?: () => string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class GrokNotificationRouter {
  private projector: GrokTurnProjector | undefined;
  private replayBuffer: AgentEvent[] | undefined;
  private readonly options: GrokSessionOptionsState;
  private readonly sink: GrokNotificationSink;

  constructor(options: GrokSessionOptionsState, sink: GrokNotificationSink) {
    this.options = options;
    this.sink = sink;
  }

  /** Start a live turn; the returned projector is closed by the caller. */
  beginTurn(runId: string | undefined): GrokTurnProjector {
    const projector = new GrokTurnProjector({
      ...(runId !== undefined ? { runId } : {}),
      createMessageId: () => `grok-${randomUUID()}`,
      ...(this.sink.now ? { now: this.sink.now } : {}),
    });
    this.projector = projector;
    return projector;
  }

  endTurn(): void {
    this.projector = undefined;
  }

  beginReplay(buffer: AgentEvent[]): void {
    this.replayBuffer = buffer;
    this.projector = this.createReplayProjector();
  }

  endReplay(): void {
    if (this.projector !== undefined && this.replayBuffer !== undefined) {
      this.replayBuffer.push(...this.projector.finish('completed'));
    }
    this.projector = undefined;
    this.replayBuffer = undefined;
  }

  /**
   * Handle one notification. `boundSessionId` is empty until `session/new`
   * returns: Grok pushes setup-time updates before the id exists, and one
   * process serves exactly one session, so there is no cross-talk.
   */
  handle(method: string, params: unknown, boundSessionId: string): void {
    const record = asRecord(params);
    if (method === '_x.ai/models/update') {
      this.options.applyModels(params);
      this.sink.publishOptions();
      return;
    }
    if (method !== 'session/update' || record === undefined) {
      return;
    }
    if (boundSessionId !== '' && record.sessionId !== boundSessionId) {
      return;
    }
    const update = asRecord(record.update);
    if (this.replayBuffer !== undefined && update?.sessionUpdate === 'user_message_chunk') {
      this.replayBuffer.push(...this.replayUserMessage(update));
      return;
    }
    const projector = this.projector;
    if (projector === undefined) {
      // Idle-time updates (commands, mode, title) still matter.
      this.applySignals(new GrokTurnProjector({ createMessageId: () => 'idle' }).project(update).signals);
      return;
    }
    const projection = projector.project(update);
    if (this.replayBuffer !== undefined) {
      this.replayBuffer.push(...projection.events);
    } else {
      this.sink.emitAll(projection.events);
    }
    this.applySignals(projection.signals);
  }

  /** Replay a user row: close open assistant text, then emit a user message. */
  private replayUserMessage(update: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (this.projector !== undefined) {
      events.push(...this.projector.finish('completed'));
    }
    this.projector = this.createReplayProjector();
    const content = asRecord(update.content);
    const text = typeof content?.text === 'string' ? content.text : '';
    if (text !== '') {
      const messageId = `grok-replay-${randomUUID()}`;
      events.push(
        { type: 'message/start', messageId, role: 'user' },
        { type: 'message/text_delta', messageId, delta: text },
        { type: 'message/end', messageId },
      );
    }
    return events;
  }

  private createReplayProjector(): GrokTurnProjector {
    return new GrokTurnProjector({
      createMessageId: () => `grok-replay-${randomUUID()}`,
      ...(this.sink.now ? { now: this.sink.now } : {}),
    });
  }

  private applySignals(signals: readonly GrokSessionSignal[]): void {
    let optionsChanged = false;
    for (const signal of signals) {
      switch (signal.kind) {
        case 'title':
          this.sink.onTitle(signal.title);
          break;
        case 'mode':
          this.options.confirmMode(signal.modeId);
          optionsChanged = true;
          break;
        case 'commands':
          this.options.applyCommands(signal.commands);
          optionsChanged = true;
          break;
        case 'config-options':
          this.options.applyConfigOptions(signal.configOptions);
          optionsChanged = true;
          break;
        case 'plan':
          break;
      }
    }
    if (optionsChanged) {
      this.sink.publishOptions();
    }
  }
}
