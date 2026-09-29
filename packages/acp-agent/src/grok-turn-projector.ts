/**
 * Per-turn projection of Grok ACP `session/update` notifications into piwin
 * `AgentEvent`s (ADR 0082).
 *
 * Grok message chunks carry no ids, so the projector allocates one assistant
 * message id per contiguous text run and closes it when a tool call starts or
 * the turn ends. Tool calls are merged by `toolCallId`.
 */

import type { AgentEvent } from '@piwin/contracts';
import {
  applyGrokToolUpdate,
  createGrokToolState,
  isGrokToolTerminal,
  presentGrokTool,
  type GrokToolState,
} from './grok-tool-projection.js';

export type GrokTurnProjectorOptions = {
  runId?: string;
  createMessageId: () => string;
  now?: () => string;
};

/** Non-message side effects the Host needs from a session update. */
export type GrokSessionSignal =
  | { kind: 'title'; title: string }
  | { kind: 'mode'; modeId: string }
  | { kind: 'commands'; commands: unknown[] }
  | { kind: 'config-options'; configOptions: unknown[] }
  | { kind: 'plan'; entries: unknown[] };

export type GrokProjection = {
  events: AgentEvent[];
  signals: GrokSessionSignal[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function contentText(content: unknown): string | undefined {
  const block = asRecord(content);
  if (block?.type === 'text' && typeof block.text === 'string') {
    return block.text;
  }
  return undefined;
}

export class GrokTurnProjector {
  private readonly runId: string | undefined;
  private readonly createMessageId: () => string;
  private readonly now: () => string;
  private assistantMessageId: string | undefined;
  private lastAssistantMessageId: string | undefined;
  private readonly tools = new Map<string, GrokToolState>();

  constructor(options: GrokTurnProjectorOptions) {
    this.runId = options.runId;
    this.createMessageId = options.createMessageId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Assistant message that received the most recent text, if any. */
  get latestAssistantMessageId(): string | undefined {
    return this.assistantMessageId ?? this.lastAssistantMessageId;
  }

  /** Project one `session/update` params.update object. */
  project(update: unknown): GrokProjection {
    const record = asRecord(update);
    const result: GrokProjection = { events: [], signals: [] };
    if (record === undefined) {
      return result;
    }
    switch (record.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = contentText(record.content);
        if (text !== undefined && text !== '') {
          const messageId = this.ensureAssistantMessage(result.events);
          result.events.push({ type: 'message/text_delta', messageId, delta: text, ...this.run() });
        }
        break;
      }
      case 'agent_thought_chunk': {
        const text = contentText(record.content);
        if (text !== undefined && text !== '') {
          const messageId = this.ensureAssistantMessage(result.events);
          result.events.push({
            type: 'message/thinking_delta',
            messageId,
            delta: text,
            ...this.run(),
          });
        }
        break;
      }
      case 'tool_call':
        this.projectToolCall(record, result.events);
        break;
      case 'tool_call_update':
        this.projectToolUpdate(record, result.events);
        break;
      case 'session_info_update': {
        if (typeof record.title === 'string' && record.title.trim() !== '') {
          result.signals.push({ kind: 'title', title: record.title.trim() });
        }
        break;
      }
      case 'current_mode_update': {
        if (typeof record.currentModeId === 'string') {
          result.signals.push({ kind: 'mode', modeId: record.currentModeId });
        }
        break;
      }
      case 'available_commands_update': {
        if (Array.isArray(record.availableCommands)) {
          result.signals.push({ kind: 'commands', commands: record.availableCommands });
        }
        break;
      }
      case 'config_option_update': {
        if (Array.isArray(record.configOptions)) {
          result.signals.push({ kind: 'config-options', configOptions: record.configOptions });
        }
        break;
      }
      case 'plan': {
        if (Array.isArray(record.entries)) {
          result.signals.push({ kind: 'plan', entries: record.entries });
        }
        break;
      }
      default:
        break;
    }
    return result;
  }

  /**
   * Close the open assistant message and terminate tools still open at turn
   * end. Returns the id of the last assistant message (for usage binding).
   */
  finish(outcome: 'completed' | 'aborted' | 'failed'): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const state of this.tools.values()) {
      if (!isGrokToolTerminal(state)) {
        state.status = outcome === 'completed' ? 'completed' : 'failed';
        state.endedAt = this.now();
        events.push({
          type: 'tool/end',
          toolCallId: state.toolCallId,
          isError: outcome !== 'completed',
          presentation: presentGrokTool(state),
          ...this.run(),
        });
      }
    }
    this.closeAssistantMessage(events);
    return events;
  }

  private projectToolCall(record: Record<string, unknown>, events: AgentEvent[]): void {
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : '';
    if (toolCallId === '') {
      return;
    }
    const existing = this.tools.get(toolCallId);
    if (existing !== undefined) {
      // A repeated tool_call (load replay) is treated as an update.
      this.projectToolUpdate(record, events);
      return;
    }
    const responseMessageId = this.lastAssistantMessageId ?? this.assistantMessageId;
    this.closeAssistantMessage(events);
    const state = createGrokToolState(record, this.now());
    this.tools.set(toolCallId, state);
    events.push({
      type: 'tool/start',
      toolCallId,
      toolName: state.toolName,
      presentation: presentGrokTool(state),
      ...(responseMessageId !== undefined ? { responseMessageId } : {}),
      ...this.run(),
    });
    if (isGrokToolTerminal(state)) {
      events.push(this.toolEnd(state));
    }
  }

  private projectToolUpdate(record: Record<string, unknown>, events: AgentEvent[]): void {
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : '';
    const state = this.tools.get(toolCallId);
    if (state === undefined) {
      if (toolCallId !== '') {
        this.projectToolCall({ ...record, sessionUpdate: 'tool_call' }, events);
      }
      return;
    }
    if (isGrokToolTerminal(state)) {
      return;
    }
    applyGrokToolUpdate(state, record, this.now());
    if (isGrokToolTerminal(state)) {
      events.push(this.toolEnd(state));
      return;
    }
    events.push({
      type: 'tool/update',
      toolCallId,
      delta: '',
      presentation: presentGrokTool(state),
      ...this.run(),
    });
  }

  private toolEnd(state: GrokToolState): AgentEvent {
    return {
      type: 'tool/end',
      toolCallId: state.toolCallId,
      isError: state.status === 'failed',
      presentation: presentGrokTool(state),
      ...this.run(),
    };
  }

  private ensureAssistantMessage(events: AgentEvent[]): string {
    if (this.assistantMessageId !== undefined) {
      return this.assistantMessageId;
    }
    const messageId = this.createMessageId();
    this.assistantMessageId = messageId;
    events.push({ type: 'message/start', messageId, role: 'assistant', ...this.run() });
    return messageId;
  }

  private closeAssistantMessage(events: AgentEvent[]): void {
    if (this.assistantMessageId === undefined) {
      return;
    }
    events.push({ type: 'message/end', messageId: this.assistantMessageId, ...this.run() });
    this.lastAssistantMessageId = this.assistantMessageId;
    this.assistantMessageId = undefined;
  }

  private run(): { runId?: string } {
    return this.runId !== undefined ? { runId: this.runId } : {};
  }
}
