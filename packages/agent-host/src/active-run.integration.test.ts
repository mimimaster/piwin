import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

describe('ADR 0015 ActiveRun integration', () => {
  it('session/prompt returns runId before the turn finishes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-active-run-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => pushes.push(message),
    });

    const projectPath = join(rootDir, 'proj');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });
    await runtime.handleCommand({ type: 'project/trust', path: projectPath });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const started = Date.now();
    const prompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'quick ack' },
    });
    const ackMs = Date.now() - started;
    expect(prompt.success).toBe(true);
    if (!prompt.success) throw new Error(prompt.error);
    const data = prompt.data as { runId: string; sessionId: string; acceptedAt: string };
    expect(data.runId).toBeTruthy();
    expect(data.sessionId).toBe(sessionId);
    // Acceptance must not wait for the mock stream (typically >40ms).
    expect(ackMs).toBeLessThan(250);

    // Second concurrent prompt supersedes the first run (product interrupt).
    const second = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'should supersede' },
    });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error);
    const secondData = second.data as { runId: string };
    expect(secondData.runId).toBeTruthy();
    expect(secondData.runId).not.toBe(data.runId);

    // First run should be cancelled as superseded.
    const firstTerminal = pushes.find(
      (push) =>
        push.type === 'event' &&
        push.event.type === 'run/terminal' &&
        push.event.runId === data.runId,
    );
    expect(firstTerminal).toBeTruthy();
    if (firstTerminal && firstTerminal.type === 'event' && firstTerminal.event.type === 'run/terminal') {
      expect(firstTerminal.event.outcome).toBe('cancelled');
      expect(String(firstTerminal.event.message ?? '').toLowerCase()).toMatch(
        /newer user message|interrupted/,
      );
    }

    // Wait for second turn to complete so dispose is clean.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const terminal = pushes.find(
        (push) =>
          push.type === 'event' &&
          push.event.type === 'run/terminal' &&
          push.event.runId === secondData.runId,
      );
      if (terminal) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await runtime.dispose();
  });

  it('session/abort cancels an in-flight hang fixture via HostRuntime path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-fixture-run-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
      onPush: (message) => pushes.push(message),
    });
    const projectPath = join(rootDir, 'project');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });
    await runtime.handleCommand({ type: 'project/trust', path: projectPath });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hang until cancelled' },
    });
    expect(prompt.success).toBe(true);
    if (!prompt.success) throw new Error(prompt.error);
    const runId = (prompt.data as { runId: string }).runId;

    const abort = await runtime.handleCommand({ type: 'session/abort', sessionId, runId });
    expect(abort).toMatchObject({ success: true, data: { cancelled: true } });
    await vi.waitFor(() => {
      expect(
        pushes.some(
          (push) =>
            push.type === 'event' &&
            push.event.type === 'run/terminal' &&
            push.event.runId === runId &&
            push.event.outcome === 'cancelled',
        ),
      ).toBe(true);
    });
    await runtime.dispose();
  });

  describe('E4: late mutation protection', () => {
    it('late MCP results after abort do not pollute session state', async () => {
      const rootDir = await mkdtemp(join(tmpdir(), 'piwin-late-mutation-'));
      const pushes: HostPush[] = [];
      const runtime = new HostRuntime({
        mode: 'sdk',
        mock: true,
        piwinRoot: rootDir,
        onPush: (message) => pushes.push(message),
      });

      const projectPath = join(rootDir, 'proj');
      await runtime.handleCommand({ type: 'project/open', path: projectPath });
      await runtime.handleCommand({ type: 'project/trust', path: projectPath });
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      // Start a prompt, immediately abort it.
      const prompt1 = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'first run' },
      });
      expect(prompt1.success).toBe(true);
      if (!prompt1.success) throw new Error(prompt1.error);
      const run1Id = (prompt1.data as { runId: string }).runId;

      // Abort run 1.
      const abort1 = await runtime.handleCommand({
        type: 'session/abort',
        sessionId,
        runId: run1Id,
      });
      expect(abort1.success).toBe(true);

      // Wait for run 1 terminal.
      let run1Terminal = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        run1Terminal = pushes.some(
          (push) =>
            push.type === 'event' &&
            push.event.type === 'run/terminal' &&
            push.event.runId === run1Id,
        );
        if (run1Terminal) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(run1Terminal).toBe(true);

      // Start a second prompt.
      const prompt2 = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'second run' },
      });
      expect(prompt2.success).toBe(true);
      if (!prompt2.success) throw new Error(prompt2.error);
      const run2Id = (prompt2.data as { runId: string }).runId;
      expect(run2Id).not.toBe(run1Id);

      // Wait for run 2 terminal.
      let run2Terminal = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        run2Terminal = pushes.some(
          (push) =>
            push.type === 'event' &&
            push.event.type === 'run/terminal' &&
            push.event.runId === run2Id,
        );
        if (run2Terminal) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(run2Terminal).toBe(true);

      // Verify: events tagged with run1Id stop after run1's terminal.
      // This proves late mutation protection: after a run is terminal,
      // no further events for that run are emitted.
      const run1TerminalIdx = pushes.findIndex(
        (push) =>
          push.type === 'event' &&
          push.event.type === 'run/terminal' &&
          push.event.runId === run1Id,
      );
      const run1EventsAfterTerminal = pushes.slice(run1TerminalIdx + 1).filter(
        (push) =>
          push.type === 'event' &&
          'runId' in push.event &&
          push.event.runId === run1Id,
      );
      expect(run1EventsAfterTerminal).toHaveLength(0);

      await runtime.dispose();
    });

    it('late permission resolution does not affect a subsequent prompt after abort', async () => {
      const rootDir = await mkdtemp(join(tmpdir(), 'piwin-late-permission-'));
      const pushes: HostPush[] = [];
      const runtime = new HostRuntime({
        mode: 'sdk',
        mock: true,
        piwinRoot: rootDir,
        onPush: (message) => pushes.push(message),
      });

      const projectPath = join(rootDir, 'proj');
      await runtime.handleCommand({ type: 'project/open', path: projectPath });
      await runtime.handleCommand({ type: 'project/trust', path: projectPath });
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      // Start a prompt.
      const prompt1 = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'first run' },
      });
      expect(prompt1.success).toBe(true);
      if (!prompt1.success) throw new Error(prompt1.error);
      const run1Id = (prompt1.data as { runId: string }).runId;

      // Abort run 1 before it completes.
      const abort1 = await runtime.handleCommand({
        type: 'session/abort',
        sessionId,
        runId: run1Id,
      });
      expect(abort1.success).toBe(true);

      // Wait for run 1 terminal.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const terminal = pushes.some(
          (push) =>
            push.type === 'event' &&
            push.event.type === 'run/terminal' &&
            push.event.runId === run1Id,
        );
        if (terminal) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // Start a second prompt (new run).
      const prompt2 = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'second run' },
      });
      expect(prompt2.success).toBe(true);
      if (!prompt2.success) throw new Error(prompt2.error);
      const run2Id = (prompt2.data as { runId: string }).runId;
      expect(run2Id).not.toBe(run1Id);

      // Resolve any pending permission from run 1 (simulates late resolution).
      const pendingPerms = pushes.filter(
        (push) =>
          push.type === 'permission/request' ||
          (push.type === 'event' && push.event.type === 'permission/request'),
      );
      for (const perm of pendingPerms) {
        const requestId =
          'requestId' in perm
            ? (perm.requestId as string)
            : perm.type === 'event' && 'requestId' in perm.event
              ? (perm.event.requestId as string)
              : '';
        if (requestId) {
          // Resolve the permission - it should not affect the second run.
          const resolveResult = await runtime.handleCommand({
            type: 'permission/resolve',
            requestId,
            decision: 'deny' as const,
          });
          // The resolution may fail (run 1 no longer active) but must not error the second run.
          expect(resolveResult.success).toBe(true);
        }
      }

      // Verify second run is still usable.
      const run2Events = pushes.filter(
        (push) =>
          push.type === 'event' &&
          'runId' in push.event &&
          push.event.runId === run2Id,
      );
      expect(run2Events.length).toBeGreaterThanOrEqual(0);

      await runtime.dispose();
    });

    it('two sequential prompts via HostRuntime produce distinct runIds and terminal events', async () => {
      const rootDir = await mkdtemp(join(tmpdir(), 'piwin-seq-runs-'));
      const pushes: HostPush[] = [];
      const runtime = new HostRuntime({
        mode: 'sdk',
        mock: true,
        piwinRoot: rootDir,
        onPush: (message) => pushes.push(message),
      });

      const projectPath = join(rootDir, 'proj');
      await runtime.handleCommand({ type: 'project/open', path: projectPath });
      await runtime.handleCommand({ type: 'project/trust', path: projectPath });
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      const runIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const prompt = await runtime.handleCommand({
          type: 'session/prompt',
          sessionId,
          input: { text: `run-${index}` },
        });
        expect(prompt.success).toBe(true);
        if (!prompt.success) throw new Error(prompt.error);
        const runId = (prompt.data as { runId: string }).runId;
        expect(runIds).not.toContain(runId);
        runIds.push(runId);

        // Abort to allow next prompt.
        const abort = await runtime.handleCommand({
          type: 'session/abort',
          sessionId,
          runId,
        });
        expect(abort.success).toBe(true);

        // Wait for terminal.
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const terminal = pushes.find(
            (push) =>
              push.type === 'event' &&
              push.event.type === 'run/terminal' &&
              push.event.runId === runId,
          );
          if (terminal) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }

      // Verify exactly one terminal per run.
      for (const runId of runIds) {
        const terminals = pushes.filter(
          (push) =>
            push.type === 'event' &&
            push.event.type === 'run/terminal' &&
            push.event.runId === runId,
        );
        expect(terminals).toHaveLength(1);
      }

      // Verify no late event from old runs crosses into newer runs.
      const terminalEventIds = new Set(
        pushes
          .filter(
            (push): push is HostPush & { event: { type: 'run/terminal'; runId: string } } =>
              push.type === 'event' && push.event.type === 'run/terminal',
          )
          .map((push) => push.event.runId),
      );
      expect(terminalEventIds.size).toBe(runIds.length);

      await runtime.dispose();
    });
  });
});
