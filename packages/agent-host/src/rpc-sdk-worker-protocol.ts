/**
 * CE-SUB-ORCH: JSONL protocol for the piwin-owned isolated SDK worker.
 *
 * The worker runs as a child process (Node.js) with stdin/stdout JSONL.
 * The parent (worker client) owns the child process, request map, abort
 * propagation, exit handling, and cleanup. The worker maps Pi-native
 * events to normalized `AgentEvent` before emission — Pi-native payloads
 * never cross the parent boundary.
 */

import type { AgentEvent } from '@piwin/contracts';

/** Worker request methods. */
export type WorkerRequestMethod =
  | 'session/create'
  | 'session/prompt'
  | 'session/abort'
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

/** Union of all worker → parent frames. */
export type WorkerFrame = WorkerResponse | WorkerEvent;

/** Payload variants for worker requests. */
export type WorkerRequestPayload =
  | {
      method: 'session/create';
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
      text: string;
    }
  | {
      method: 'session/abort';
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
      if (parsed.type === 'response' && typeof parsed.id === 'string') {
        return parsed as WorkerResponse;
      }
      if (parsed.type === 'event' && typeof parsed.sessionId === 'string') {
        return parsed as WorkerEvent;
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
