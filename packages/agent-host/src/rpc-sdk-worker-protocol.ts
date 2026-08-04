/**
 * CE-SUB-ORCH / Phase 7: JSONL protocol for the piwin-owned isolated SDK worker.
 *
 * The worker runs as a child process (Node.js) with stdin/stdout JSONL.
 * The parent (worker client) owns the child process, request map, abort
 * propagation, exit handling, and cleanup. The worker maps Pi-native
 * events to normalized `AgentEvent` before emission — Pi-native payloads
 * never cross the parent boundary.
 *
 * Phase 7 plan §4: custom tool execution is proxied to the parent Host via
 * `tool-call` / `tool-result` frames. The worker never re-implements web,
 * MCP, process, browser, notes, flashcards, or image generation executors.
 */

import type { AgentEvent } from '@piwin/contracts';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
} from './rpc/serializable-blueprint.js';

/** Worker request methods. */
export type WorkerRequestMethod =
  | 'session/create'
  | 'session/prompt'
  | 'session/abort'
  | 'session/steer'
  | 'session/follow-up'
  | 'session/drop';

/** Worker request frame (parent → worker via stdin). */
export type WorkerRequest = {
  type: 'request';
  id: string;
  method: WorkerRequestMethod;
  payload: WorkerRequestPayload;
};

/** Worker response frame (worker → parent via stdout). */
export type WorkerResponse = {
  type: 'response';
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

/** Worker event frame (worker → parent via stdout, streaming). */
export type WorkerEvent = {
  type: 'event';
  sessionId: string;
  event: AgentEvent;
};

/**
 * Worker → parent: a custom tool invocation that requires parent authority
 * (permission/MCP/process/browser/secrets). Phase 7 plan §7.
 */
export type WorkerToolCallFrame = {
  type: 'tool-call';
  id: string;
  sessionId: string;
  toolName: string;
  args: unknown;
  /** Optional parent-side abort correlation id. */
  signalId?: string;
};

/**
 * Parent → worker: tool call resolution (via stdin response channel).
 * The worker correlates by the frame `id`. The `code` field carries the
 * stable `HostToolErrorCode` so the worker can map it to model-facing text.
 */
export type WorkerToolResultFrame = {
  type: 'tool-result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: 'tool-not-available' | 'tool-disabled' | 'permission-denied' | 'aborted';
};

/** Worker → parent: startup handshake advertising protocol/capabilities. */
export type WorkerHelloFrame = {
  type: 'hello';
  protocolVersion: 1;
  workerPid: number;
  capabilities: {
    toolProxy: true;
    steer: true;
    followUp: true;
    preparedPrompt: true;
  };
};

/** Worker → parent: graceful shutdown signal (§4.1). */
export type WorkerShutdownFrame = {
  type: 'shutdown';
  reason: 'parent-dispose' | 'worker-fatal' | 'protocol-error';
};

/** Union of all worker → parent frames. */
export type WorkerFrame =
  WorkerResponse | WorkerEvent | WorkerToolCallFrame | WorkerHelloFrame | WorkerShutdownFrame;

/** Payload variants for worker requests. */
export type WorkerRequestPayload =
  | {
      method: 'session/create';
      /** Blueprint-first product path (Phase 7). */
      productSessionId: string;
      blueprint: SerializableBlueprint;
      providers?: SerializableProviderRuntime[];
    }
  | {
      method: 'session/create';
      /** Legacy subagent-task path (isolated task runner). */
      projectPath: string;
      workingDirectory: string;
      profileId?: string;
      modelProtocol?: string;
      modelProviderId?: string;
      modelModelId?: string;
      thinkingLevel?: string;
      capabilities?: string[];
      skillIds?: string[];
      isolation: 'readonly' | 'worktree';
    }
  | {
      method: 'session/prompt';
      sessionId: string;
      /** Prepared prompt text (parent owns PromptPreparation; no path injection). */
      text: string;
      /** Native image content parts (base64 over stdio). */
      images?: Array<{ mimeType: string; dataBase64: string }>;
      thinkingLevel?: string;
      model?: { providerId: string; modelId: string };
    }
  | {
      method: 'session/abort';
      sessionId: string;
    }
  | {
      method: 'session/steer';
      sessionId: string;
      message: string;
    }
  | {
      method: 'session/follow-up';
      sessionId: string;
      message: string;
    }
  | {
      method: 'session/drop';
      sessionId: string;
    };

/** Parse a JSONL line into a WorkerFrame. Returns undefined for malformed lines. */
export function parseWorkerFrame(line: string): WorkerFrame | undefined {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object') {
      if (parsed.type === 'response' && typeof parsed.id === 'string') {
        return parsed as WorkerResponse;
      }
      if (parsed.type === 'event' && typeof parsed.sessionId === 'string') {
        return parsed as WorkerEvent;
      }
      if (
        parsed.type === 'tool-call' &&
        typeof parsed.id === 'string' &&
        typeof parsed.toolName === 'string'
      ) {
        return parsed as WorkerToolCallFrame;
      }
      if (parsed.type === 'hello' && parsed.protocolVersion === 1) {
        return parsed as WorkerHelloFrame;
      }
      if (
        parsed.type === 'shutdown' &&
        (parsed.reason === 'parent-dispose' ||
          parsed.reason === 'worker-fatal' ||
          parsed.reason === 'protocol-error')
      ) {
        return parsed as WorkerShutdownFrame;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Serialize a WorkerRequest to a JSONL line. */
export function serializeWorkerRequest(request: WorkerRequest): string {
  return JSON.stringify(request);
}
