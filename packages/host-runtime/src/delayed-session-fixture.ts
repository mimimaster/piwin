import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentMessageView,
  PromptInput,
  SessionCompactResult,
  SessionHandle,
  SessionTreeView,
} from '@piwin/contracts';

type Listener = (event: AgentEvent) => void;

/**
 * Injectable delay function. Tests can replace the default setTimeout-based
 * implementation with a deferred-promise controller for deterministic timing.
 */
export type DelayFn = (ms: number) => Promise<void>;

const defaultDelay: DelayFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type DelayedSessionDelays = {
  /** Delay before the first text delta is emitted (simulates model connect + first token). */
  firstTokenMs?: number;
  /** Delay between each text delta chunk (simulates token generation rate). */
  tokenIntervalMs?: number;
  /** Delay before tool/start is emitted after the first token. */
  toolStartMs?: number;
  /** Delay between tool/start and tool/end (simulates tool execution). */
  toolDurationMs?: number;
  /** Delay before abort() takes effect (simulates provider cancellation latency). */
  cancellationAckMs?: number;
  /** When true, prompt() never resolves until abort() is called. */
  hangUntilAbort?: boolean;
};

export type DelayedSessionOptions = {
  sessionId?: string;
  projectPath?: string;
  delays?: DelayedSessionDelays;
  /** Injectable delay implementation for deterministic tests. */
  delayFn?: DelayFn;
  /** Number of text delta chunks to emit. Default 5. */
  chunkCount?: number;
  /** Text content for each chunk. Default "chunk-N ". */
  chunkText?: (index: number) => string;
  /**
   * Test-only synthetic tool output size. This exercises transcript retention
   * through the normal SessionHandle -> HostRuntime event path.
   */
  toolOutputBytes?: number;
  /** Size of each synthetic tool/update event. Default 64 KiB. */
  toolOutputChunkBytes?: number;
};

/**
 * A controllable SessionHandle fixture for responsiveness testing.
 *
 * Unlike MockSessionHandle (which emits a fast deterministic stream), this
 * fixture can independently delay acceptance, first token, token stream,
 * tool calls, and cancellation acknowledgement. It is designed to reproduce
 * the exact failure modes identified in the responsiveness audit:
 *
 * - hangUntilAbort: simulates a provider that accepts TCP but never responds.
 * - cancellationAckMs: simulates slow provider cancellation.
 * - firstTokenMs: simulates slow model connect / first token.
 * - toolDurationMs: simulates a slow MCP or bash tool call.
 *
 * The fixture does not require a real provider, API key, or network access.
 */
export function createDelayedSessionHandle(
  options: DelayedSessionOptions = {},
): SessionHandle & {
  /** Resolves when the current prompt() call has fully settled. */
  promptSettled: Promise<void>;
  /** True after abort() has been called. */
  abortRequested: boolean;
  /** Number of text deltas emitted before abort or completion. */
  emittedDeltaCount: number;
} {
  const sessionId = options.sessionId ?? randomUUID();
  const projectPath = options.projectPath ?? '/tmp/delayed-fixture';
  const delays = options.delays ?? {};
  const delay = options.delayFn ?? defaultDelay;
  const chunkCount = options.chunkCount ?? 5;
  const chunkText = options.chunkText ?? ((index: number) => `chunk-${index} `);
  const toolOutputBytes = options.toolOutputBytes ?? 0;
  const toolOutputChunkBytes = options.toolOutputChunkBytes ?? 64 * 1024;

  if (!Number.isSafeInteger(toolOutputBytes) || toolOutputBytes < 0) {
    throw new RangeError('toolOutputBytes must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(toolOutputChunkBytes) || toolOutputChunkBytes <= 0) {
    throw new RangeError('toolOutputChunkBytes must be a positive safe integer');
  }

  const listeners = new Set<Listener>();
  const messages: AgentMessageView[] = [];
  let aborted = false;
  let abortRequested = false;
  let emittedDeltaCount = 0;
  let promptSettleResolve: (() => void) | null = null;
  let promptSettled: Promise<void> = Promise.resolve();

  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  /** Wait for the specified delay, but resolve immediately if aborted. */
  async function interruptibleDelay(ms: number | undefined): Promise<boolean> {
    if (ms === undefined || ms <= 0) {
      return aborted;
    }
    // Poll in small increments so abort can interrupt long waits.
    const pollIntervalMs = 10;
    let elapsed = 0;
    while (elapsed < ms) {
      if (aborted) {
        return true;
      }
      const step = Math.min(pollIntervalMs, ms - elapsed);
      await delay(step);
      elapsed += step;
    }
    return aborted;
  }

  const handle: SessionHandle & {
    promptSettled: Promise<void>;
    abortRequested: boolean;
    emittedDeltaCount: number;
  } = {
    id: sessionId,

    get promptSettled() {
      return promptSettled;
    },

    get abortRequested() {
      return abortRequested;
    },

    get emittedDeltaCount() {
      return emittedDeltaCount;
    },

    async prompt(promptInput: PromptInput): Promise<void> {
      aborted = false;
      abortRequested = false;
      emittedDeltaCount = 0;
      promptSettled = new Promise<void>((resolve) => {
        promptSettleResolve = resolve;
      });

      const assistantMessageId = randomUUID();
      const userText = promptInput.text.trim() || '(empty)';

      messages.push({
        id: randomUUID(),
        role: 'user',
        text: userText,
        createdAt: new Date().toISOString(),
      });

      messages.push({
        id: assistantMessageId,
        role: 'assistant',
        text: '',
        createdAt: new Date().toISOString(),
      });

      emit({ type: 'message/start', messageId: assistantMessageId, role: 'assistant' });

      // Phase: first token delay (simulates model connect + waiting for first token).
      if (await interruptibleDelay(delays.firstTokenMs)) {
        finishAborted(assistantMessageId);
        return;
      }

      // Optional tool call before text streaming.
      if (
        delays.toolStartMs !== undefined ||
        delays.toolDurationMs !== undefined ||
        toolOutputBytes > 0
      ) {
        const toolCallId = randomUUID();
        if (await interruptibleDelay(delays.toolStartMs)) {
          finishAborted(assistantMessageId);
          return;
        }
        emit({ type: 'tool/start', toolCallId, toolName: 'delayed_fixture_tool' });
        if (await interruptibleDelay(delays.toolDurationMs)) {
          emit({ type: 'tool/end', toolCallId, isError: true });
          finishAborted(assistantMessageId);
          return;
        }
        if (toolOutputBytes === 0) {
          emit({ type: 'tool/update', toolCallId, delta: 'fixture tool output' });
        } else {
          let emittedToolOutputBytes = 0;
          while (emittedToolOutputBytes < toolOutputBytes) {
            const remainingBytes = toolOutputBytes - emittedToolOutputBytes;
            const nextChunkBytes = Math.min(toolOutputChunkBytes, remainingBytes);
            emit({
              type: 'tool/update',
              toolCallId,
              delta: 'x'.repeat(nextChunkBytes),
            });
            emittedToolOutputBytes += nextChunkBytes;
          }
        }
        emit({ type: 'tool/end', toolCallId, isError: false });
      }

      // Phase: token streaming.
      let assembled = '';
      for (let index = 0; index < chunkCount; index += 1) {
        if (aborted) {
          finishAborted(assistantMessageId, assembled);
          return;
        }
        const chunk = chunkText(index);
        assembled += chunk;
        emittedDeltaCount += 1;
        emit({ type: 'message/text_delta', messageId: assistantMessageId, delta: chunk });

        if (index < chunkCount - 1) {
          if (await interruptibleDelay(delays.tokenIntervalMs)) {
            finishAborted(assistantMessageId, assembled);
            return;
          }
        }
      }

      // hangUntilAbort: block indefinitely until abort() is called.
      if (delays.hangUntilAbort === true) {
        while (!aborted) {
          await delay(50);
        }
        finishAborted(assistantMessageId, assembled);
        return;
      }

      // Normal completion.
      const existing = messages.find((message) => message.id === assistantMessageId);
      if (existing) {
        existing.text = assembled;
      }
      emit({ type: 'message/end', messageId: assistantMessageId });
      settlePrompt();
    },

    async steer(message: string): Promise<void> {
      emit({
        type: 'error',
        message: `delayed fixture steer ignored: ${message}`,
        retriable: false,
      });
    },

    async followUp(message: string): Promise<void> {
      await handle.prompt({ text: message, streamingBehavior: 'followUp' });
    },

    async abort(): Promise<void> {
      abortRequested = true;
      // Simulate provider cancellation latency.
      if (delays.cancellationAckMs !== undefined && delays.cancellationAckMs > 0) {
        await delay(delays.cancellationAckMs);
      }
      aborted = true;
    },

    async compact(): Promise<SessionCompactResult> {
      return { ok: false, message: 'delayed fixture does not support compaction' };
    },

    async getMessages(): Promise<AgentMessageView[]> {
      return [...messages];
    },

    async getTree(): Promise<SessionTreeView> {
      return { root: null, activeLeafId: null };
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  function finishAborted(messageId: string, partialText?: string): void {
    const existing = messages.find((message) => message.id === messageId);
    if (existing && partialText !== undefined) {
      existing.text = partialText;
    }
    emit({ type: 'session/aborted', sessionId, messageId });
    settlePrompt();
  }

  function settlePrompt(): void {
    if (promptSettleResolve) {
      promptSettleResolve();
      promptSettleResolve = null;
    }
  }

  return handle;
}
