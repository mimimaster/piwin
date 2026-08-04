/**
 * Phase 7: worker entry point for the piwin-owned isolated SDK worker.
 *
 * Runs inside a child process. Reads JSONL requests on stdin, writes
 * responses/events to stdout, and sends diagnostics to stderr (no secrets).
 *
 * The worker does NOT load `~/.piwin/config.json` for capability decisions;
 * it receives exact SerializableBlueprint per session (Phase 7 plan §5).
 * Custom tool execution is proxied to the parent (WP4); this entry wires the
 * session runtime and streams normalized AgentEvent only.
 */

import { createInterface } from 'node:readline';
import type { WorkerRequest, WorkerToolResultFrame } from './rpc-sdk-worker-protocol.js';
import { WorkerSessionRuntime } from './rpc/worker-session-runtime.js';
import { createWorkerPiSessionFactory } from './rpc/worker-pi-session-factory.js';

function writeLine(frame: unknown): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

// Startup handshake (Phase 7 plan §4.1).
writeLine({
  type: 'hello',
  protocolVersion: 1,
  workerPid: process.pid,
  capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
});

const runtime = new WorkerSessionRuntime({
  sendFrame: (frame) => writeLine(frame),
  createPiSession: createWorkerPiSessionFactory(),
  // WP4: enable tool proxy so the runtime builds proxy tools for the
  // blueprint's customToolNames. Proxy executors send tool-call frames
  // via sendFrame and are resolved by handleToolResult from stdin.
  enableToolProxy: true,
});

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed) as { type?: string };
    if (parsed.type === 'tool-result') {
      // Parent → worker: tool result for a pending proxy call.
      runtime.handleToolResult(parsed as WorkerToolResultFrame);
      return;
    }
    const request = parsed as WorkerRequest;
    if (request && request.type === 'request' && request.id) {
      void runtime.handleRequest(request).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[worker] handler error: ${message}\n`);
      });
    } else {
      process.stderr.write(`[worker] malformed request frame\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[worker] parse error: ${message}\n`);
  }
});

rl.on('close', () => {
  // Graceful shutdown signal (Phase 7 plan §4.1).
  writeLine({ type: 'shutdown', reason: 'parent-dispose' });
  process.exit(0);
});

// Fatal error handler — emit shutdown before exiting.
process.on('uncaughtException', (error) => {
  process.stderr.write(`[worker] uncaught: ${error.message}\n`);
  writeLine({ type: 'shutdown', reason: 'worker-fatal' });
  process.exit(1);
});

process.stdin.resume();
