/**
 * OpenAI-completions parsed-body idle guard. Pi's HTTP idle timer treats SSE
 * keep-alive comments as activity; this companion only watches assistant
 * message progress and shares Pi's httpIdleTimeoutMs.
 */

import {
  failedAgentPromptOutcome,
  type AgentFailure,
  type AgentPromptOutcome,
} from '@piwin/contracts';
import { readNestedRole, readRole, readString } from './pi-event-read.js';
import { createPiPromptOutcomeTracker } from './pi-prompt-outcome-tracker.js';

const DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS = 300_000;

export type ParsedStreamGuardLogger = {
  error(message: string, cause?: unknown): void;
};

export type ParsedStreamGuardResult = {
  stalled: boolean;
  abortError?: unknown;
};

export function readPiHttpIdleTimeoutMs(settingsManager: unknown): number {
  if (!isObject(settingsManager)) return DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS;
  const getter = Reflect.get(settingsManager, 'getHttpIdleTimeoutMs');
  if (typeof getter !== 'function') return DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS;
  const value = Reflect.apply(getter, settingsManager, []);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS;
}

export function isOpenAiCompletionsStreamProtocol(protocol: string | undefined): boolean {
  return protocol === 'openai-completions' || protocol === 'openai-compatible';
}

export function createStalledStreamFailure(timeoutMs: number, abortError?: unknown): AgentFailure {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const message =
    abortError === undefined
      ? `Model stream stalled: no model progress was received for ${seconds} seconds while the connection remained open.`
      : `Model stream stalled: no model progress was received for ${seconds} seconds while the connection remained open. Abort failed: ${
          abortError instanceof Error ? abortError.message : String(abortError)
        }`;
  return {
    code: 'model-stream-stalled',
    origin: 'transport',
    message,
    retriable: true,
  };
}

export async function runPiPromptWithParsedStreamGuard(input: {
  enabled: boolean;
  timeoutMs: number;
  prompt: () => Promise<void>;
  abort: () => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
  logger?: ParsedStreamGuardLogger;
}): Promise<ParsedStreamGuardResult> {
  if (!input.enabled || input.timeoutMs === 0) {
    await input.prompt();
    return { stalled: false };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let assistantStreaming = false;
  let stalled = false;
  let abortError: unknown;
  let abortChain: Promise<void> = Promise.resolve();

  const disarm = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const requestAbort = (): void => {
    abortChain = abortChain.then(async () => {
      try {
        await input.abort();
      } catch (error) {
        abortError = error;
        input.logger?.error('parsed-stream guard abort failed', error);
      }
    });
  };

  const arm = (): void => {
    disarm();
    timer = setTimeout(() => {
      timer = undefined;
      if (stalled) {
        return;
      }
      stalled = true;
      requestAbort();
    }, input.timeoutMs);
  };

  const unsubscribe = input.subscribe((event) => {
    if (!isObject(event)) {
      return;
    }
    const type = readString(event.type);
    if (type === 'message_start') {
      const role = readRole(event.role) ?? readNestedRole(event, 'message');
      assistantStreaming = role === undefined || role === 'assistant';
      if (assistantStreaming) {
        arm();
      } else {
        disarm();
      }
      return;
    }
    if (type === 'message_update') {
      if (assistantStreaming) {
        arm();
      }
      return;
    }
    if (
      type === 'message_end' ||
      type === 'agent_end' ||
      type === 'tool_execution_start' ||
      type === 'auto_retry_start' ||
      type === 'compaction_start'
    ) {
      assistantStreaming = false;
      disarm();
    }
  });

  try {
    await input.prompt();
    await abortChain;
    return abortError === undefined ? { stalled } : { stalled, abortError };
  } finally {
    disarm();
    unsubscribe();
  }
}

export async function runTrackedGuardedPiPrompt(input: {
  enabled: boolean;
  timeoutMs: number;
  prompt: () => Promise<void>;
  abort: () => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
  logger?: ParsedStreamGuardLogger;
}): Promise<AgentPromptOutcome> {
  const tracker = createPiPromptOutcomeTracker();
  const unsubscribe = input.subscribe((raw) => {
    tracker.observe(raw);
  });
  try {
    const guard = await runPiPromptWithParsedStreamGuard(input);
    if (guard.stalled) {
      return failedAgentPromptOutcome(
        createStalledStreamFailure(input.timeoutMs, guard.abortError),
      );
    }
    return tracker.finalize();
  } finally {
    unsubscribe();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
