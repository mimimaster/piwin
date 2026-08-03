/**
 * CE-SUB-ORCH: worker entry point for the piwin-owned isolated SDK worker.
 *
 * Runs inside a child process. Reads JSONL requests on stdin, writes
 * responses/events to stdout, and sends diagnostics to stderr (no secrets).
 * Creates a PiSdkAdapter and session services inside the child process.
 *
 * This entry is intentionally minimal: it wires the existing PiSdkAdapter
 * to the JSONL protocol. The parent (RpcSdkWorkerClient) owns the process.
 */

import { createInterface } from 'node:readline';
import {
  serializeWorkerRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './rpc-sdk-worker-protocol.js';

// Worker entry: read JSONL from stdin, process, write JSONL to stdout.
const rl = createInterface({ input: process.stdin, terminal: false });

function send(frame: WorkerResponse): void {
  process.stdout.write(JSON.stringify(frame) + '\n');
}

function sendError(id: string, message: string): void {
  send({ type: 'response', id, success: false, error: message });
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  const { id, method, payload } = request;
  try {
    switch (method) {
      case 'session/create': {
        // TODO: Create a PiSdkAdapter session inside this process.
        // For now, return a stub session id. The real implementation will
        // call createPiSdkSession with the payload fields.
        const sessionId = `worker-session-${id.slice(0, 8)}`;
        send({ type: 'response', id, success: true, data: { sessionId } });
        break;
      }
      case 'session/prompt': {
        // TODO: Prompt the session and stream events.
        send({ type: 'response', id, success: true, data: {} });
        break;
      }
      case 'session/abort': {
        // TODO: Abort the running prompt.
        send({ type: 'response', id, success: true, data: {} });
        break;
      }
      case 'session/steer': {
        // TODO: Steer the in-flight run with a new user message.
        send({ type: 'response', id, success: true, data: {} });
        break;
      }
      case 'session/follow-up': {
        // TODO: Follow up on the completed run.
        send({ type: 'response', id, success: true, data: {} });
        break;
      }
      case 'session/drop': {
        // TODO: Clean up the session.
        send({ type: 'response', id, success: true, data: {} });
        break;
      }
      default:
        sendError(id, `unknown method: ${method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, message);
  }
}

rl.on('line', (line: string) => {
  try {
    const request = JSON.parse(line) as WorkerRequest;
    if (request && request.type === 'request' && request.id) {
      void handleRequest(request);
    } else {
      process.stderr.write(`[worker] malformed request: ${line}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[worker] parse error: ${message}\n`);
  }
});

rl.on('close', () => {
  process.exit(0);
});

// Keep the process alive until stdin closes.
process.stdin.resume();
