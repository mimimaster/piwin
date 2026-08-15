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

import type {
  AgentEvent,
  BackendRunInterventionEvent,
  SessionSeedMessage,
  ToolResult,
  ToolResultErrorCode,
} from '@piwin/contracts';
import type {
  SerializableBlueprint,
  SerializableWorkerProviderRuntime,
} from './rpc/serializable-blueprint.js';

/** Worker request methods. */
export type WorkerRequestMethod =
  | 'session/create'
  | 'session/prompt'
  | 'session/abort'
  | 'session/steer'
  | 'session/follow-up'
  | 'session/intervention-arm'
  | 'session/intervention-cancel'
  | 'session/compact'
  | 'session/compact-abort'
  | 'session/drop';

/** Worker request frame (parent → worker via stdin). */
export type WorkerRequest = {
  type: 'request';
  id: string;
  method: WorkerRequestMethod;
  context: WorkerFrameContext;
  payload: WorkerRequestPayload;
};

/** Identity carried by every non-handshake worker frame. */
export type WorkerFrameContext = {
  sessionId: string;
  runtimeGenerationId: string;
  runId?: string;
  toolCallId?: string;
};

/** Worker response frame (worker → parent via stdout). */
export type WorkerResponse = {
  type: 'response';
  id: string;
  context: WorkerFrameContext;
  success: boolean;
  data?: unknown;
  error?: string;
};

/** Worker event frame (worker → parent via stdout, streaming). */
export type WorkerEvent = {
  type: 'event';
  context: WorkerFrameContext;
  event: AgentEvent;
};

/**
 * Worker → parent: a custom tool invocation that requires parent authority
 * (permission/MCP/process/browser/secrets). Phase 7 plan §7.
 */
export type WorkerToolCallFrame = {
  type: 'tool-call';
  id: string;
  context: WorkerFrameContext;
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
  context: WorkerFrameContext;
  ok: boolean;
  /** Complete Host result; legacy error/code fields remain parse-compatible. */
  result?: ToolResult;
  error?: string;
  /** Legacy top-level error message kept for older worker parsers. */
  message?: string;
  code?: ToolResultErrorCode;
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
    providerSecretBootstrap?: true;
  };
};

/** Worker → parent: graceful shutdown signal (§4.1). */
export type WorkerShutdownFrame = {
  type: 'shutdown';
  reason: 'parent-dispose' | 'worker-fatal' | 'protocol-error';
};

/**
 * Worker → parent: extension UI request (§3.2 authority matrix).
 * The worker's Pi extension context needs a confirm/select/input dialog
 * that only the parent can display. The parent resolves and sends back
 * a `extension-ui-response` frame.
 */
export type WorkerExtensionUiRequestFrame = {
  type: 'extension-ui-request';
  id: string;
  context: WorkerFrameContext;
  kind: 'confirm' | 'select' | 'input';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
};

/** Parent → worker: extension UI response. */
export type WorkerExtensionUiResponseFrame = {
  type: 'extension-ui-response';
  id: string;
  context: WorkerFrameContext;
  ok: boolean;
  result?:
    | { kind: 'confirm'; confirmed: boolean }
    | { kind: 'select'; value?: string; cancelled?: boolean }
    | { kind: 'input'; value?: string; cancelled?: boolean };
  error?: string;
};

/** Worker asks the parent Host to durably claim a staged intervention revision. */
export type WorkerInterventionClaimFrame = {
  type: 'intervention-claim';
  id: string;
  context: WorkerFrameContext;
  event: Extract<BackendRunInterventionEvent, { type: 'claim' }>;
};

/** Parent answers a worker claim before the worker injects model-visible content. */
export type WorkerInterventionPermitFrame = {
  type: 'intervention-permit';
  id: string;
  context: WorkerFrameContext;
  accepted: boolean;
};

/** Worker reports post-claim application or terminal staging outcomes. */
export type WorkerInterventionEventFrame = {
  type: 'intervention-event';
  context: WorkerFrameContext;
  event: Exclude<BackendRunInterventionEvent, { type: 'claim' }>;
};

/**
 * Parent → worker: internal resource query (ADR 0040 §8). The worker answers
 * with its current `process.memoryUsage()` snapshot. Strict frame: no
 * per-process secrets, PIDs, or environment details cross the boundary.
 */
export type WorkerResourceRequestFrame = {
  type: 'resource-request';
  id: string;
};

/** Worker → parent: resource query answer with current memory usage. */
export type WorkerResourceResponseFrame = {
  type: 'resource-response';
  id: string;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  /** Monotonic worker timestamp of the sample. */
  sampledAtMs: number;
};

/** Union of all worker → parent frames. */
export type WorkerFrame =
  | WorkerResponse
  | WorkerEvent
  | WorkerToolCallFrame
  | WorkerHelloFrame
  | WorkerShutdownFrame
  | WorkerExtensionUiRequestFrame
  | WorkerInterventionClaimFrame
  | WorkerInterventionEventFrame
  | WorkerResourceResponseFrame;

/** Payload variants for worker requests. */
export type WorkerRequestPayload =
  | {
      method: 'session/create';
      /** Blueprint-first product path (Phase 7). */
      productSessionId: string;
      blueprint: SerializableBlueprint;
      providers?: SerializableWorkerProviderRuntime[];
      seedMessages?: readonly SessionSeedMessage[];
      seedMode?: 'compaction' | 'replay';
    }
  | {
      method: 'session/prompt';
      sessionId: string;
      /** Prepared prompt text (parent owns PromptPreparation; no path injection). */
      text: string;
      /** Native image content parts (base64 over stdio). */
      images?: Array<{ mimeType: string; dataBase64: string }>;
      streamingBehavior?: 'steer' | 'followUp';
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
      method: 'session/intervention-arm';
      sessionId: string;
      intervention: import('@piwin/contracts').BackendRunIntervention;
    }
  | {
      method: 'session/intervention-cancel';
      sessionId: string;
      interventionId: string;
      expectedRevision: number;
    }
  | {
      method: 'session/compact';
      sessionId: string;
      customInstructions?: string;
    }
  | {
      method: 'session/compact-abort';
      sessionId: string;
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
      if (
        parsed.type === 'response' &&
        typeof parsed.id === 'string' &&
        isFrameContext(parsed.context)
      ) {
        return parsed as WorkerResponse;
      }
      if (parsed.type === 'event' && isFrameContext(parsed.context)) {
        return parsed as WorkerEvent;
      }
      if (
        parsed.type === 'tool-call' &&
        typeof parsed.id === 'string' &&
        typeof parsed.toolName === 'string' &&
        isFrameContext(parsed.context)
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
      if (
        parsed.type === 'extension-ui-request' &&
        typeof parsed.id === 'string' &&
        isFrameContext(parsed.context) &&
        (parsed.kind === 'confirm' || parsed.kind === 'select' || parsed.kind === 'input')
      ) {
        return parsed as WorkerExtensionUiRequestFrame;
      }
      if (
        parsed.type === 'intervention-claim' &&
        typeof parsed.id === 'string' &&
        isFrameContext(parsed.context)
      ) {
        return parsed as WorkerInterventionClaimFrame;
      }
      if (parsed.type === 'intervention-event' && isFrameContext(parsed.context)) {
        return parsed as WorkerInterventionEventFrame;
      }
      if (
        parsed.type === 'resource-response' &&
        typeof parsed.id === 'string' &&
        isMemorySnapshot(parsed.memory) &&
        typeof parsed.sampledAtMs === 'number'
      ) {
        return parsed as WorkerResourceResponseFrame;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isMemorySnapshot(value: unknown): value is WorkerResourceResponseFrame['memory'] {
  if (!value || typeof value !== 'object') return false;
  const memory = value as Record<string, unknown>;
  return (
    typeof memory.rssBytes === 'number' &&
    typeof memory.heapUsedBytes === 'number' &&
    typeof memory.heapTotalBytes === 'number' &&
    typeof memory.externalBytes === 'number'
  );
}

function isFrameContext(value: unknown): value is WorkerFrameContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  return (
    typeof context.sessionId === 'string' &&
    context.sessionId.length > 0 &&
    typeof context.runtimeGenerationId === 'string' &&
    context.runtimeGenerationId.length > 0 &&
    (context.runId === undefined || typeof context.runId === 'string') &&
    (context.toolCallId === undefined || typeof context.toolCallId === 'string')
  );
}

/** Serialize a WorkerRequest to a JSONL line. */
export function serializeWorkerRequest(request: WorkerRequest): string {
  return JSON.stringify(request);
}

/** Serialize an internal resource query to a JSONL line (ADR 0040 §8). */
export function serializeWorkerResourceRequest(request: WorkerResourceRequestFrame): string {
  return JSON.stringify(request);
}
