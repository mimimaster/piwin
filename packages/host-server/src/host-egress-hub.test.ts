import { describe, expect, it } from 'vitest';
import type { HostPush, HostPushFrame, PushSink } from '@piwin/contracts';
import { HostEgressHub } from './host-egress-hub.js';

describe('HostEgressHub', () => {
  it('uses one canonical sequence for replay and connected clients', async () => {
    let runtimeSink: PushSink | undefined;
    let detachCount = 0;
    const sentFrames: HostPushFrame[] = [];
    const hub = new HostEgressHub({
      attachRuntimeSink: (sink) => {
        runtimeSink = sink;
        return () => {
          detachCount += 1;
        };
      },
    });

    hub.start();
    expect(runtimeSink?.sequenced).toBe(false);
    hub.attachClient({
      id: 'client-1',
      canSend: () => true,
      sendNow: (frame) => sentFrames.push(frame),
      closeSlowConsumer: () => undefined,
    });

    runtimeSink?.push(createStatusPush());
    await waitForDrain();

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]?.seq).toBe(1);
    expect(sentFrames[0]?.eventId).toMatch(/[0-9a-f-]{36}/);
    expect(sentFrames[0]?.eventId).toBe(sentFrames[0]?.push.eventId);
    expect(hub.selectReplay(0)).toMatchObject({
      complete: true,
      currentSeq: 1,
      frames: sentFrames,
    });

    hub.stop();
    expect(detachCount).toBe(1);
  });

  it('closes a client whose bounded queue is full without stopping the journal', () => {
    let runtimeSink: PushSink | undefined;
    let closeReason: string | undefined;
    const hub = new HostEgressHub({
      attachRuntimeSink: (sink) => {
        runtimeSink = sink;
        return () => undefined;
      },
      maxClientQueueItems: 1,
      maxClientQueueBytes: 1024 * 1024,
    });

    hub.start();
    hub.attachClient({
      id: 'slow-client',
      canSend: () => false,
      sendNow: () => undefined,
      closeSlowConsumer: (reason) => {
        closeReason = reason;
      },
    });

    runtimeSink?.push(createStatusPush());
    runtimeSink?.push(createStatusPush());

    expect(closeReason).toBe('slow-consumer');
    expect(hub.getCurrentSeq()).toBe(2);
    expect(hub.selectReplay(0).frames.map((frame) => frame.seq)).toEqual([1, 2]);

    hub.stop();
  });

  it('holds live pushes during replay and drains them afterward', async () => {
    let runtimeSink: PushSink | undefined;
    const sentFrames: HostPushFrame[] = [];
    const hub = new HostEgressHub({
      attachRuntimeSink: (sink) => {
        runtimeSink = sink;
        return () => undefined;
      },
    });

    hub.start();
    runtimeSink?.push(createStatusPush());
    const detach = hub.attachClient({
      id: 'reconnecting-client',
      canSend: () => true,
      sendNow: (frame) => sentFrames.push(frame),
      closeSlowConsumer: () => undefined,
    });
    hub.pauseClient('reconnecting-client');
    runtimeSink?.push(createStatusPush());

    expect(sentFrames).toHaveLength(0);
    expect(hub.selectReplay(1).frames.map((frame) => frame.seq)).toEqual([2]);

    hub.resumeClient('reconnecting-client');
    await waitForDrain();
    expect(sentFrames.map((frame) => frame.seq)).toEqual([2]);

    detach();
    hub.stop();
  });

  it('keeps ingress diagnostics bounded and exposes payload-free egress stats', async () => {
    let runtimeSink: PushSink | undefined;
    const sentFrames: HostPushFrame[] = [];
    const hub = new HostEgressHub({
      maxPendingDiagnosticItems: 1,
      maxPendingDiagnosticBytes: 10_000,
      attachRuntimeSink: (sink) => {
        runtimeSink = sink;
        return () => undefined;
      },
    });

    hub.start();
    hub.attachClient({
      id: 'stats-client',
      canSend: () => true,
      sendNow: (frame) => sentFrames.push(frame),
      closeSlowConsumer: () => undefined,
    });

    runtimeSink?.push({ type: 'host/log', level: 'info', message: 'first' });
    runtimeSink?.push({ type: 'host/log', level: 'info', message: 'second' });
    hub.flush();
    await waitForDrain();

    const stats = hub.getStats();
    expect(sentFrames).toHaveLength(1);
    expect(stats.ingressByType['host/log']).toBe(2);
    expect(stats.canonicalByPolicy.diagnostic).toBe(1);
    expect(stats.diagnosticsEvicted).toBe(1);
    expect(stats.clients[0]).toMatchObject({ clientId: 'stats-client', sentItems: 1 });

    hub.stop();
  });

  it('keeps a started queued turn ahead of the replacement Run events', async () => {
    let runtimeSink: PushSink | undefined;
    const sentFrames: HostPushFrame[] = [];
    const hub = new HostEgressHub({
      attachRuntimeSink: (sink) => {
        runtimeSink = sink;
        return () => undefined;
      },
    });
    hub.start();
    hub.attachClient({
      id: 'ordering-client',
      canSend: () => true,
      sendNow: (frame) => sentFrames.push(frame),
      closeSlowConsumer: () => undefined,
    });

    runtimeSink?.push({
      type: 'run/terminal',
      run: {
        runId: 'run-old',
        kind: 'session-turn',
        status: 'cancelled',
        rootRunId: 'run-old',
        sessionId: 'session-1',
      },
    });
    runtimeSink?.push({
      type: 'run/updated',
      run: {
        runId: 'run-new',
        kind: 'session-turn',
        status: 'running',
        rootRunId: 'run-new',
        sessionId: 'session-1',
      },
    });
    runtimeSink?.push({
      type: 'session/queued-turn-updated',
      queuedTurn: {
        queuedTurnId: 'queued-1',
        revision: 2,
        sessionId: 'session-1',
        sequence: 1,
        userMessageId: 'user-1',
        mode: 'replace',
        status: 'started',
        replaceRunId: 'run-old',
        startedRunId: 'run-new',
        input: { text: 'replacement', clientMessageId: 'user-1' },
        submittedAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:01.000Z',
      },
    });
    hub.flush();
    await waitForDrain();

    expect(sentFrames.map((frame) => frame.push.type)).toEqual([
      'run/terminal',
      'session/queued-turn-updated',
      'run/updated',
    ]);
    hub.stop();
  });
});

function createStatusPush(): HostPush {
  return { type: 'host/status', mode: 'sdk', ready: true, mock: true };
}

function waitForDrain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 32));
}
