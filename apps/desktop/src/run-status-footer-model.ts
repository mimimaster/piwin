/**
 * Pure projection behind the run status footer: the one live line pinned to
 * the foot of the current response while a run is open
 * (`✳ 3m 40s · 1.9k tokens · 解析上下文与指令…`).
 */
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import type { ModelWaitTail } from './model-wait-tail';
import { sessionRunPhaseToActivityKind } from './run-activity-mappers.js';
import type { RunActivityInput } from './run-activity-types.js';

// CJK ideographs, kana, hangul and full-width forms tokenize near one per char.
const DENSE_SCRIPT = /[぀-ヿ㐀-鿿가-힯＀-￯]/gu;
const LATIN_CHARS_PER_TOKEN = 4;

/** Rough token count for streamed model output; no tokenizer on the client. */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0;
  const dense = text.match(DENSE_SCRIPT)?.length ?? 0;
  return dense + Math.ceil((text.length - dense) / LATIN_CHARS_PER_TOKEN);
}

/**
 * Output generated so far by the active run: answer text, reasoning, and tool
 * call arguments (live arg progress while streaming, the preview once the
 * call started). Host usage only lands per finished request, so the live
 * counter is an estimate.
 */
export function estimateRunOutputTokens(
  messages: readonly ChatMessageUi[],
  activeRunId: string | null,
): number {
  let total = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (activeRunId !== null && message.runId !== undefined && message.runId !== activeRunId) {
      continue;
    }
    total += estimateTextTokens(message.text) + estimateTextTokens(message.thinking);
    if (message.toolArgsProgress) {
      total += Math.ceil(message.toolArgsProgress.argumentCharCount / LATIN_CHARS_PER_TOKEN);
    }
    for (const tool of message.tools) {
      total += estimateTextTokens(tool.presentation?.inputPreview ?? '');
    }
  }
  return total;
}

function resolveRunningToolDetail(tool: ChatMessageUi['tools'][number]): string | undefined {
  const presentation = tool.presentation;
  const detail =
    presentation?.command?.trim() ||
    presentation?.targetPaths?.[0]?.trim() ||
    presentation?.summary?.trim();
  return detail || undefined;
}

/** Carousel input for the footer phrase, from run phase + the running tool. */
export function resolveRunStatusActivityInput(input: {
  messages: readonly ChatMessageUi[];
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
  modelWaitTail: ModelWaitTail | null;
  locale: 'zh-CN' | 'en';
}): RunActivityInput {
  const { locale } = input;
  if (input.modelWaitTail) {
    return {
      kind: input.modelWaitTail.kind === 'reconnecting' ? 'connecting-model' : 'waiting-first-token',
      locale,
    };
  }

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role !== 'assistant') continue;
    const running = message.tools.find((tool) => tool.status === 'running');
    if (!running) continue;
    const detail = resolveRunningToolDetail(running);
    const actionVerb = running.presentation?.actionVerb;
    return {
      kind: 'working',
      locale,
      activeToolName: running.toolName,
      ...(detail !== undefined ? { detail } : {}),
      ...(actionVerb !== undefined ? { actionVerb } : {}),
    };
  }

  const record = input.activeRunId ? input.runRecordsById[input.activeRunId] : undefined;
  const phase = record?.phaseHistory[record.phaseHistory.length - 1]?.phase;
  const kind = phase ? sessionRunPhaseToActivityKind(phase) : 'connecting-model';
  // Streaming without a running tool is the model thinking or writing; the
  // generic "working" bank would read like tool work that is not happening.
  return { kind: kind === 'working' ? 'waiting-first-token' : kind, locale };
}

/** Clock origin: Host run start, else the turn's user message. */
export function resolveRunStatusStartedAt(input: {
  messages: readonly ChatMessageUi[];
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
}): number | undefined {
  const record = input.activeRunId ? input.runRecordsById[input.activeRunId] : undefined;
  if (typeof record?.startedAt === 'number') return record.startedAt;
  const user = input.messages.find((message) => message.role === 'user');
  const parsed = user?.createdAt ? Date.parse(user.createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
