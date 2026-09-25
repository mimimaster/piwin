import type { ModelRef } from '@piwin/contracts';
import type {
  MobileMediaAttachment,
  MobileToolCall,
  MobileTranscriptMessage,
} from '../../mobile-transcript.js';

/**
 * Transcript projection for the phone: one user card, then one assistant turn
 * per Host run. Pi emits one assistant message per model step (think → tool →
 * think → tool → answer); showing each step with its own avatar is what made
 * the old chain unreadable. The turn folds every step into one work thread and
 * keeps only the final answer as prose.
 */
export type TurnStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type WorkStep =
  | { kind: 'thinking'; id: string; text: string; streaming: boolean }
  | { kind: 'narration'; id: string; text: string }
  /** A user instruction the Host injected into this live run (ADR 0051). */
  | { kind: 'intervention'; id: string; text: string; applied: boolean }
  | { kind: 'tool'; id: string; messageId: string; tool: MobileToolCall };

export interface TurnProse {
  messageId: string;
  text: string;
  streaming: boolean;
}

export interface TurnView {
  id: string;
  runId: string | undefined;
  /** The user row this turn answers; the anchor for retry (ADR 0064). */
  userMessage: { id: string; text: string } | undefined;
  model: ModelRef | undefined;
  createdAt: string;
  status: TurnStatus;
  steps: WorkStep[];
  prose: TurnProse | undefined;
  toolCount: number;
  /** Unique paths the Host reported as touched (targets + writes). */
  fileCount: number;
  changedPaths: string[];
  durationMs: number | undefined;
  terminalMessage: string | undefined;
}

export type TranscriptEntry =
  | {
      kind: 'user';
      id: string;
      text: string;
      createdAt: string;
      attachments: MobileMediaAttachment[];
    }
  | { kind: 'turn'; id: string; turn: TurnView }
  | { kind: 'note'; id: string; text: string };

export interface BuildTranscriptOptions {
  /** Host-owned run that is still live; its turn stays `running` between steps. */
  activeRunId?: string | undefined;
  /** A run exists but no assistant message has arrived yet. */
  awaitingResponse?: boolean;
  /**
   * User rows the Host holds as queued turns. They render in the queue strip
   * until admitted, so they must not look like the start of a new turn.
   */
  queuedUserMessageIds?: ReadonlySet<string>;
}

interface TurnDraft {
  id: string;
  runId: string | undefined;
  userMessage: { id: string; text: string } | undefined;
  /** Assistant messages and in-run interventions, in transcript order. */
  messages: MobileTranscriptMessage[];
}

const PENDING_QUEUE_STATUSES: ReadonlySet<string> = new Set(['pending', 'starting']);

export function buildTranscriptEntries(
  messages: readonly MobileTranscriptMessage[],
  options: BuildTranscriptOptions = {},
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let draft: TurnDraft | undefined;
  let lastUser: { id: string; text: string } | undefined;

  const flush = (): void => {
    if (draft !== undefined) {
      entries.push({ kind: 'turn', id: draft.id, turn: projectTurn(draft, options.activeRunId) });
      draft = undefined;
    }
  };

  for (const message of messages) {
    if (message.role === 'user') {
      const delivery = message.instructionDelivery;
      if (
        options.queuedUserMessageIds?.has(message.id) === true ||
        (delivery?.kind === 'queued-turn' && PENDING_QUEUE_STATUSES.has(delivery.status))
      ) {
        continue;
      }
      if (delivery?.kind === 'run-intervention' && draft !== undefined) {
        // Part of the live run's chain, not the start of a new turn.
        draft.messages.push(message);
        continue;
      }
      flush();
      lastUser = { id: message.id, text: message.text };
      entries.push({
        kind: 'user',
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        attachments: message.attachments ?? [],
      });
      continue;
    }
    if (message.role === 'system') {
      if (message.text.trim().length > 0) {
        flush();
        entries.push({ kind: 'note', id: message.id, text: message.text });
      }
      continue;
    }
    if (message.role !== 'assistant') {
      continue;
    }
    const sameRun =
      draft !== undefined &&
      (draft.runId === undefined || message.runId === undefined || draft.runId === message.runId);
    if (!sameRun) {
      flush();
    }
    if (draft === undefined) {
      draft = { id: `turn:${message.id}`, runId: message.runId, userMessage: lastUser, messages: [] };
    }
    draft.runId ??= message.runId;
    draft.messages.push(message);
  }
  flush();

  const last = entries[entries.length - 1];
  if (options.awaitingResponse === true && last?.kind === 'user') {
    entries.push({
      kind: 'turn',
      id: `turn:pending:${last.id}`,
      turn: pendingTurn({ id: last.id, text: last.text }, options.activeRunId),
    });
  }
  return entries;
}

function pendingTurn(userMessage: { id: string; text: string }, runId: string | undefined): TurnView {
  return {
    id: `turn:pending:${userMessage.id}`,
    runId,
    userMessage,
    model: undefined,
    createdAt: new Date().toISOString(),
    status: 'running',
    steps: [],
    prose: undefined,
    toolCount: 0,
    fileCount: 0,
    changedPaths: [],
    durationMs: undefined,
    terminalMessage: undefined,
  };
}

function projectTurn(draft: TurnDraft, activeRunId: string | undefined): TurnView {
  const steps: WorkStep[] = [];
  const touched = new Set<string>();
  const changed = new Set<string>();
  let toolCount = 0;
  let prose: TurnProse | undefined;
  const assistantMessages = draft.messages.filter((message) => message.role === 'assistant');
  const answerIds = resolveAnswerMessageIds(assistantMessages);
  const proseParts: string[] = [];
  let proseMessageId: string | undefined;
  let proseStreaming = false;

  for (const message of draft.messages) {
    if (message.role === 'user') {
      steps.push({
        kind: 'intervention',
        id: `${message.id}:interject`,
        text: message.text,
        applied: message.instructionDelivery?.status === 'applied',
      });
      continue;
    }
    const streaming = message.status === 'streaming';
    const thinking = message.thinking?.trim() ?? '';
    if (thinking.length > 0) {
      steps.push({ kind: 'thinking', id: `${message.id}:think`, text: thinking, streaming: streaming && message.text.length === 0 });
    }
    const tools = message.toolCalls ?? [];
    if (answerIds.has(message.id)) {
      if (message.text.trim().length > 0) proseParts.push(message.text);
      proseMessageId ??= message.id;
      proseStreaming ||= streaming;
    } else if (message.text.trim().length > 0) {
      steps.push({ kind: 'narration', id: `${message.id}:say`, text: message.text.trim() });
    }
    for (const tool of tools) {
      toolCount += 1;
      steps.push({ kind: 'tool', id: tool.id, messageId: message.id, tool });
      const presentation = tool.presentation;
      for (const path of presentation?.targetPaths ?? tool.targetPaths ?? []) touched.add(path);
      for (const path of presentation?.changedPaths ?? []) {
        touched.add(path);
        changed.add(path);
      }
    }
  }
  if (proseMessageId !== undefined && (proseParts.length > 0 || proseStreaming)) {
    prose = { messageId: proseMessageId, text: proseParts.join('\n\n'), streaming: proseStreaming };
  }
  const lastMessage = assistantMessages[assistantMessages.length - 1];

  return {
    id: draft.id,
    runId: draft.runId,
    userMessage: draft.userMessage,
    model: assistantMessages.find((message) => message.model !== undefined)?.model,
    createdAt: assistantMessages[0]?.createdAt ?? new Date().toISOString(),
    status: resolveStatus(draft, activeRunId),
    steps,
    prose,
    toolCount,
    fileCount: touched.size,
    changedPaths: [...changed],
    durationMs: resolveDuration(draft),
    terminalMessage: lastMessage?.terminalMessage,
  };
}

/**
 * The answer is every tool-free assistant message after the last tool call.
 * Pi may close a run with an empty assistant message, so "the last message"
 * is not a safe definition.
 */
function resolveAnswerMessageIds(assistants: readonly MobileTranscriptMessage[]): Set<string> {
  let lastToolIndex = -1;
  assistants.forEach((message, index) => {
    if ((message.toolCalls ?? []).length > 0) lastToolIndex = index;
  });
  const ids = new Set<string>();
  for (const message of assistants.slice(lastToolIndex + 1)) {
    if (message.text.length > 0 || message.status === 'streaming') ids.add(message.id);
  }
  return ids;
}

function resolveStatus(draft: TurnDraft, activeRunId: string | undefined): TurnStatus {
  const live =
    draft.messages.some(
      (message) =>
        message.status === 'streaming' ||
        (message.toolCalls ?? []).some((tool) => tool.status === 'running'),
    ) ||
    (activeRunId !== undefined && draft.runId === activeRunId);
  if (live) {
    return 'running';
  }
  const assistants = draft.messages.filter((message) => message.role === 'assistant');
  const last = assistants[assistants.length - 1];
  if (last?.outcome === 'cancelled') {
    return 'cancelled';
  }
  if (last?.outcome === 'failed' || last?.status === 'error') {
    return 'failed';
  }
  return 'done';
}

function resolveDuration(draft: TurnDraft): number | undefined {
  const first = draft.messages[0];
  const last = draft.messages[draft.messages.length - 1];
  const start = Date.parse(first?.startedAt ?? first?.createdAt ?? '');
  const end = Date.parse(last?.endedAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return undefined;
  }
  return end - start;
}

/** Fold header copy: `工作了 12 秒 · 5 个工具 · 2 个文件`. */
export function describeWork(turn: TurnView): string {
  const parts: string[] = [];
  if (turn.toolCount > 0) parts.push(`${turn.toolCount} 个工具`);
  if (turn.fileCount > 0) parts.push(`${turn.fileCount} 个文件`);
  return parts.join(' · ');
}

export function describeTurnState(turn: TurnView): string {
  switch (turn.status) {
    case 'running':
      return turn.steps.length === 0 ? '正在思考' : '正在工作';
    case 'failed':
      return '中途失败';
    case 'cancelled':
      return '已停止';
    case 'done':
      return turn.durationMs !== undefined && turn.durationMs >= 1000
        ? `工作了 ${formatSeconds(turn.durationMs)}`
        : turn.toolCount > 0
          ? '已完成'
          : '已思考';
  }
}

function formatSeconds(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
}
