import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostRuntime } from '@piwin/host-runtime';
import { HostCommandIdempotencyRegistry } from './host-command-idempotency-registry.js';
import { HostEgressHub } from './host-egress-hub.js';
import { HostServer } from './host-server.js';

describe('sidecar and standalone topology', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it('keeps one hostInstanceId and one production sink for JSONL plus injected phone-access', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-sidecar-topo-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      rootOwnership: { enabled: false },
    });
    const hub = new HostEgressHub({
      hostInstanceId: runtime.getHostInstanceId(),
      attachRuntimeSink: (sink) => runtime.attachPushSink(sink),
    });
    hub.start();
    const registry = new HostCommandIdempotencyRegistry();
    const jsonlSeqs: number[] = [];
    hub.addClient({
      id: 'local-jsonl',
      canSend: () => true,
      supportsBatch: true,
      send: (message) => {
        if (message.type === 'push/batch') {
          jsonlSeqs.push(message.throughSeq);
        } else if (message.type === 'push') {
          jsonlSeqs.push(message.seq);
        }
      },
    });
    expect(runtime.countProductionPushSinks()).toBe(1);
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: runtime.getHostInstanceId(),
      egressHub: hub,
      idempotencyRegistry: registry,
    });
    const first = await server.start();
    expect(server.getInstanceId()).toBe(runtime.getHostInstanceId());
    expect(runtime.countProductionPushSinks()).toBe(1);
    hub.ingest({ type: 'host/status', mode: 'sdk', ready: true, mock: true });
    hub.flush();
    const seqAfterFirst = hub.getCurrentSeq();
    expect(seqAfterFirst).toBeGreaterThan(0);
    await server.stop();
    expect(hub.getHostInstanceId()).toBe(runtime.getHostInstanceId());
    expect(runtime.countProductionPushSinks()).toBe(1);
    const restarted = new HostServer({
      runtime,
      port: 0,
      instanceId: runtime.getHostInstanceId(),
      egressHub: hub,
      idempotencyRegistry: registry,
    });
    const second = await restarted.start();
    expect(second.port).not.toBe(first.port);
    expect(restarted.getInstanceId()).toBe(runtime.getHostInstanceId());
    hub.ingest({ type: 'host/log', level: 'info', message: 'after-restart' });
    hub.flush();
    expect(hub.getCurrentSeq()).toBeGreaterThan(seqAfterFirst);
    expect(runtime.countProductionPushSinks()).toBe(1);
    cleanups.push(async () => {
      await restarted.stop();
      hub.dispose();
      await runtime.dispose();
    });
  });

  it('disconnects only the slow shell while the other still sees the Run terminal', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-slow-shell-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
      rootOwnership: { enabled: false },
    });
    const hub = new HostEgressHub({
      hostInstanceId: runtime.getHostInstanceId(),
      attachRuntimeSink: (sink) => runtime.attachPushSink(sink),
    });
    hub.start();
    const desktopFrames: Array<{ type: string; seq?: number }> = [];
    let slowReason: string | undefined;
    hub.addClient({
      id: 'desktop',
      canSend: () => true,
      sendNow: (frame) => {
        desktopFrames.push({ type: frame.push.type, seq: frame.seq });
      },
    });
    hub.addClient({
      id: 'mobile-slow',
      canSend: () => false,
      maxQueueItems: 2,
      maxQueueBytes: 1024,
      sendNow: () => undefined,
      closeSlowConsumer: (reason) => {
        slowReason = reason;
      },
    });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' }, sessionName: 'slow-iso' },
    });
    if (!created.success) {
      throw new Error(created.error);
    }
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hang' },
      foreground: { kind: 'if-idle' },
    });
    if (!prompted.success) {
      throw new Error(prompted.error);
    }
    const runId = (prompted.data as { runId: string }).runId;
    hub.flush();
    expect(slowReason).toBe('slow-consumer');
    const stillRunning = await runtime.handleCommand({ type: 'session/foreground-run', sessionId });
    expect(stillRunning.success).toBe(true);
    if (stillRunning.success) {
      expect((stillRunning.data as { run?: { runId?: string } | null }).run?.runId).toBe(runId);
    }
    const aborted = await runtime.handleCommand({
      type: 'session/abort',
      sessionId,
      runId,
    });
    expect(aborted.success).toBe(true);
    await vi.waitFor(() => {
      hub.flush();
      expect(desktopFrames.some((frame) => frame.type === 'run/terminal')).toBe(true);
    });
    const foreground = await runtime.handleCommand({ type: 'session/foreground-run', sessionId });
    expect(foreground.success).toBe(true);
    if (foreground.success) {
      expect((foreground.data as { run?: { runId?: string } | null }).run).toBeNull();
    }
    hub.dispose();
    await runtime.dispose();
  });

  it('joins a JSONL retry of the same local envelope as one mutation', async () => {
    const registry = new HostCommandIdempotencyRegistry();
    const command = {
      type: 'session/prompt' as const,
      sessionId: 's1',
      input: { text: 'once' },
      foreground: { kind: 'if-idle' as const },
    };
    let executions = 0;
    const { admitAndExecuteHostCommand } = await import('./host-command-idempotency-registry.js');
    const first = await admitAndExecuteHostCommand({
      registry,
      principalId: 'desktop-install-1',
      idempotencyKey: 'local-gesture',
      command,
      execute: async () => {
        executions += 1;
        return { type: 'response', command: command.type, success: true, data: { runId: 'r1' } };
      },
    });
    const retry = await admitAndExecuteHostCommand({
      registry,
      principalId: 'desktop-install-1',
      idempotencyKey: 'local-gesture',
      command,
      execute: async () => {
        executions += 1;
        return { type: 'response', command: command.type, success: true, data: { runId: 'r2' } };
      },
    });
    expect(executions).toBe(1);
    expect(first.success).toBe(true);
    expect(retry.success).toBe(true);
    if (first.success && retry.success) {
      expect(first.data).toEqual(retry.data);
    }
    expect(randomUUID().length).toBeGreaterThan(0);
  });
});
