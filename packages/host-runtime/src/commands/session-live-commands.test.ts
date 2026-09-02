import { describe, expect, it, vi } from 'vitest';
import type {
  HostPush,
  PromptInput,
  ResolvedOrchestrationScheme,
  SessionHandle,
} from '@piwin/contracts';
import { COMPLETED_STOP_OUTCOME, failedAgentPromptOutcome } from '@piwin/contracts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSessionRecord,
  loadSessionPlan,
  openSessionTranscriptStore,
  saveSessionPlan,
  type SessionTranscriptStore,
} from '@piwin/session';
import { openOrCreateProject } from '@piwin/project';
import {
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
} from '../paths.js';
import { createRemoteProjectId } from '../remote-project-id.js';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import { createDefaultPiwinConfig } from '../config-store.js';
import type { SessionLiveContext } from './session-live-commands.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import {
  createControlContext,
  createPromptContext,
  createSilentSessionHandle,
} from './session-live-test-context.js';

describe('session live control commands', () => {
  it('rejects a public target-model compact while a foreground Run is live', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createControlContext(session);
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 900_000,
      tokensLimit: 1_000_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: false, error: 'session-busy: foreground-run' });
  });

  it('explicitly compacts an oversized live source context for a target model', async () => {
    const baseSession = createDelayedSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        return { ok: true, tokensBefore: 900_000, tokensAfter: 120_000 };
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 900_000,
      tokensLimit: 1_000_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(compactCalls).toBe(1);
    expect(response).toMatchObject({
      success: true,
      data: { ok: true, compacted: true, targetInputBudget: 201_600, tokensAfter: 120_000 },
    });
    expect(context.sessionModels.get(session.id)).toEqual(largeModelRef());
  });

  it('does not compact when the measured source context already fits the target', async () => {
    const baseSession = createDelayedSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        return { ok: true, tokensBefore: 100_000, tokensAfter: 50_000 };
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 100_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(compactCalls).toBe(0);
    expect(response).toMatchObject({
      success: true,
      data: { ok: true, compacted: false, targetInputBudget: 201_600 },
    });
  });

  it('treats already-compacted as a no-op and switches when occupancy now fits', async () => {
    const baseSession = createDelayedSessionHandle();
    let compactCalls = 0;
    let usageReads = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        return { ok: false, message: 'Already compacted' };
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => {
      usageReads += 1;
      return {
        sessionId: session.id,
        tokensUsed: usageReads === 1 ? 900_000 : 80_000,
        tokensLimit: 1_000_000,
        updatedAt: new Date().toISOString(),
        source: 'pi-contextUsage',
      };
    };
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(compactCalls).toBe(1);
    expect(usageReads).toBe(2);
    expect(response).toMatchObject({
      success: true,
      data: { ok: true, compacted: false, targetInputBudget: 201_600, tokensAfter: 80_000 },
    });
  });

  it('treats a too-small native context as a target-model no-op', async () => {
    const baseSession = createDelayedSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        throw new Error('Nothing to compact (session too small)');
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 900_000,
      tokensLimit: 1_000_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(compactCalls).toBe(1);
    expect(response).toMatchObject({
      success: true,
      data: {
        ok: true,
        compacted: false,
        targetInputBudget: 201_600,
      },
    });
  });

  it('fails closed when already-compacted occupancy is unknown', async () => {
    const baseSession = createDelayedSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        throw new Error('Already compacted');
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    let usageReads = 0;
    context.loadSessionUsage = async () => {
      usageReads += 1;
      if (usageReads === 1) {
        return {
          sessionId: session.id,
          tokensUsed: 900_000,
          tokensLimit: 1_000_000,
          updatedAt: new Date().toISOString(),
          source: 'pi-contextUsage',
        };
      }
      return null;
    };
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(compactCalls).toBe(1);
    expect(response).toMatchObject({
      success: false,
      error: expect.stringMatching(/context-limit-unverified/),
    });
  });

  it('allows a known-empty cold session to switch models without compacting', async () => {
    const baseSession = createDelayedSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        return { ok: true, tokensAfter: 0 };
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => null;
    context.withTranscriptStore = async (_sessionId, operation) =>
      operation({ listTail: async () => [] } as unknown as SessionTranscriptStore);
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(compactCalls).toBe(0);
    expect(response).toMatchObject({
      success: true,
      data: {
        ok: true,
        compacted: false,
        targetInputBudget: 201_600,
      },
    });
  });

  it('does not surface Already compacted when occupancy still exceeds the target', async () => {
    const baseSession = createDelayedSessionHandle();
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        return { ok: false, message: 'Already compacted' };
      },
    };
    const { context } = createControlContext(session);
    context.getForegroundRun = () => undefined;
    context.sessionModels.set(session.id, largeModelRef());
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 900_000,
      tokensLimit: 1_000_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/compact',
        sessionId: session.id,
        targetModel: smallModelRef(),
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: false,
      error: expect.stringMatching(/context-limit-exceeded/),
    });
    expect(
      String((response as { error?: string } | null)?.error ?? '').toLowerCase(),
    ).not.toContain('already compacted');
  });

  it('wakes a cold session before compacting', async () => {
    const base = createSilentSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...base,
      async getMessages() {
        return [
          { id: 'u1', role: 'user', text: 'hello' },
          { id: 'a1', role: 'assistant', text: 'hi' },
        ];
      },
      async compact() {
        compactCalls += 1;
        return { ok: true, tokensBefore: 100, tokensAfter: 40 };
      },
    };
    const { context } = createPromptContext(session);
    context.sessions = new Map();
    context.requireSession = () => {
      throw new Error(`Unknown session: ${session.id}`);
    };
    let ensured = false;
    context.ensureLiveSession = async () => {
      ensured = true;
      context.sessions.set(session.id, session);
      return session;
    };

    const response = await handleSessionLiveCommand(
      { type: 'session/compact', sessionId: session.id },
      undefined,
      context,
    );

    expect(ensured).toBe(true);
    expect(compactCalls).toBe(1);
    expect(response).toMatchObject({
      success: true,
      data: { ok: true, tokensAfter: 40 },
    });
  });

  it('re-seeds a cold runtime from product history before compacting', async () => {
    const base = createSilentSessionHandle();
    let compactCalls = 0;
    const session: SessionHandle = {
      ...base,
      async compact() {
        compactCalls += 1;
        return { ok: true, tokensBefore: 8000, tokensAfter: 1200 };
      },
    };
    const { context } = createPromptContext(session);
    context.needsProductHistoryInjection = () => true;
    context.withTranscriptStore = async (_sessionId, operation) =>
      operation({
        buildHistoryWindow: async () => [
          { role: 'user', text: 'hello there' },
          { role: 'assistant', text: 'a long reply about the topic' },
          { role: 'user', text: 'please continue with more detail' },
          { role: 'assistant', text: 'sure, more detail follows' },
        ],
      } as never);
    let reseeded = 0;
    context.reactivateWithSeedMessages = async (_sessionId, seeds) => {
      reseeded += 1;
      expect(seeds.length).toBeGreaterThanOrEqual(2);
      return session;
    };

    const response = await handleSessionLiveCommand(
      { type: 'session/compact', sessionId: session.id },
      undefined,
      context,
    );

    expect(reseeded).toBe(1);
    expect(compactCalls).toBe(1);
    expect(response).toMatchObject({
      success: true,
      data: { ok: true, tokensAfter: 1200 },
    });
  });

  it('applies the target model without pre-compacting the source context', async () => {
    const baseSession = createDelayedSessionHandle();
    const order: string[] = [];
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        throw new Error('source compaction must not gate model switching');
      },
      async prompt(input) {
        order.push(`prompt:${input.model?.modelId ?? 'default'}`);
        return COMPLETED_STOP_OUTCOME;
      },
    };
    const { context } = createPromptContext(session);
    context.sessionModels.set(session.id, largeModelRef());
    context.replaceRuntimeForModel = async () => {
      order.push('replace-runtime');
    };
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 900_000,
      tokensLimit: 1_000_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'continue with the smaller model', model: smallModelRef() },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(compactCalls).toBe(0);
    expect(order).toEqual(['replace-runtime', 'prompt:small-252k']);
    expect(context.sessionModels.get(session.id)).toEqual(smallModelRef());
  });

  it('does not let native compaction eligibility block a model switch', async () => {
    const baseSession = createDelayedSessionHandle();
    const order: string[] = [];
    let compactCalls = 0;
    const session: SessionHandle = {
      ...baseSession,
      async compact(): Promise<import('@piwin/contracts').SessionCompactResult> {
        compactCalls += 1;
        throw new Error('Nothing to compact (session too small)');
      },
      async prompt(input) {
        order.push(`prompt:${input.model?.modelId ?? 'default'}`);
        return COMPLETED_STOP_OUTCOME;
      },
    };
    const { context } = createPromptContext(session);
    context.sessionModels.set(session.id, largeModelRef());
    context.replaceRuntimeForModel = async () => {
      order.push('replace-runtime');
    };
    context.loadSessionUsage = async () => ({
      sessionId: session.id,
      tokensUsed: 900_000,
      tokensLimit: 1_000_000,
      updatedAt: new Date().toISOString(),
      source: 'pi-contextUsage',
    });
    context.loadConfig = async () => modelSwitchConfig();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'continue despite the tiny native context', model: smallModelRef() },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(compactCalls).toBe(0);
    expect(order).toEqual(['replace-runtime', 'prompt:small-252k']);
    expect(context.sessionModels.get(session.id)).toEqual(smallModelRef());
  });

  it('persists an accepted steer with the client message id', async () => {
    const session = createDelayedSessionHandle();
    const { context, activeRun } = createControlContext(session);
    const recordedPrompts: PromptInput[] = [];
    context.recordUserPrompt = async (_sessionId, input): Promise<void> => {
      recordedPrompts.push(input);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/steer',
        sessionId: session.id,
        message: 'Use the smaller fix',
        runId: activeRun.runId,
        clientMessageId: 'client-steer-1',
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true, command: 'session/steer' });
    expect(recordedPrompts).toEqual([
      { text: 'Use the smaller fix', clientMessageId: 'client-steer-1' },
    ]);
  });

  it('durably accepts an exact-Run intervention before arming the backend', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-intervention-command-'));
    const baseSession = createDelayedSessionHandle();
    let store: Awaited<ReturnType<typeof openSessionTranscriptStore>>;
    const armRunIntervention = vi.fn(async (intervention) => {
      expect(await store.getRunIntervention(intervention.interventionId)).toMatchObject({
        status: 'pending',
        runId: intervention.runId,
      });
    });
    const session: SessionHandle = { ...baseSession, armRunIntervention };
    const control = createControlContext(session);
    control.registry.attachRuntimeGeneration(control.activeRun.runId, 'generation-1');
    store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    control.context.getTranscriptStore = async () => store;
    const pushes: HostPush[] = [];
    control.context.push = (push) => pushes.push(push);

    try {
      const response = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-1',
          userMessageId: 'user-intervention-1',
          input: { text: 'Use the smaller fix' },
        },
        undefined,
        control.context,
      );

      expect(response).toMatchObject({
        success: true,
        command: 'run/intervention-submit',
        data: { intervention: { status: 'pending', revision: 1 } },
      });
      expect(armRunIntervention).toHaveBeenCalledOnce();
      expect(pushes.map((push) => push.type)).toContain('transcript/append');
      expect(pushes.map((push) => push.type)).toContain('run/intervention-updated');
      expect(await store.buildHistoryWindow()).toEqual([]);

      const activeReplay = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-1',
          userMessageId: 'user-intervention-1',
          input: { text: 'Use the smaller fix' },
        },
        undefined,
        control.context,
      );
      expect(activeReplay).toMatchObject({
        success: true,
        data: { intervention: { interventionId: 'intervention-1', status: 'pending' } },
      });
      expect(armRunIntervention).toHaveBeenCalledTimes(2);

      control.registry.terminate(control.activeRun.runId, 'completed');
      const replay = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-1',
          userMessageId: 'user-intervention-1',
          input: { text: 'Use the smaller fix' },
        },
        undefined,
        control.context,
      );
      expect(replay).toMatchObject({
        success: true,
        data: { intervention: { interventionId: 'intervention-1', revision: 1 } },
      });
      expect(armRunIntervention).toHaveBeenCalledTimes(2);

      const conflict = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-1',
          userMessageId: 'user-intervention-1',
          input: { text: 'different instruction' },
        },
        undefined,
        control.context,
      );
      expect(conflict).toMatchObject({ success: false, error: 'idempotency-conflict' });
    } finally {
      store.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects an intervention without an exact active Run owner', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createControlContext(session);
    const response = await handleSessionLiveCommand(
      {
        type: 'run/intervention-submit',
        sessionId: session.id,
        runId: 'stale-run',
        interventionId: 'intervention-stale',
        userMessageId: 'user-stale',
        input: { text: 'late instruction' },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });
  });

  it('adopts a pending queued turn as an exact-Run intervention without duplicating the user row', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-intervention-adopt-'));
    const baseSession = createDelayedSessionHandle();
    const armRunIntervention = vi.fn(async () => undefined);
    const session: SessionHandle = { ...baseSession, armRunIntervention };
    const control = createControlContext(session);
    control.registry.attachRuntimeGeneration(control.activeRun.runId, 'generation-1');
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    control.context.getTranscriptStore = async () => store;
    const pushes: HostPush[] = [];
    control.context.push = (push) => pushes.push(push);

    try {
      const created = await store.createQueuedTurn({
        queuedTurnId: 'queued-1',
        sessionId: session.id,
        userMessageId: 'user-queued-1',
        mode: 'next',
        input: { text: 'Adjust the model mapping' },
        fingerprint: 'fingerprint-queued-1',
        submittedAt: new Date().toISOString(),
      });
      expect(created).toMatchObject({ outcome: 'created' });

      const command = {
        type: 'run/intervention-submit' as const,
        sessionId: session.id,
        runId: control.activeRun.runId,
        interventionId: 'intervention-adopt-1',
        userMessageId: 'user-queued-1',
        input: { text: 'Adjust the model mapping' },
        adoptQueuedTurn: { queuedTurnId: 'queued-1', expectedRevision: 1 },
      };
      const response = await handleSessionLiveCommand(command, undefined, control.context);

      expect(response).toMatchObject({
        success: true,
        command: 'run/intervention-submit',
        data: {
          intervention: { interventionId: 'intervention-adopt-1', status: 'pending', revision: 1 },
          queuedTurn: { queuedTurnId: 'queued-1', status: 'cancelled' },
        },
      });
      expect(armRunIntervention).toHaveBeenCalledOnce();
      expect(armRunIntervention).toHaveBeenLastCalledWith(
        expect.objectContaining({
          interventionId: 'intervention-adopt-1',
          text: 'Adjust the model mapping',
        }),
      );
      expect(pushes.map((push) => push.type)).toContain('session/queued-turn-updated');
      expect(pushes.map((push) => push.type)).toContain('run/intervention-updated');
      // The queued turn already painted the user row; adoption must re-bind
      // it, never append a second copy.
      expect(pushes.filter((push) => push.type === 'transcript/append')).toEqual([]);
      expect(await store.getQueuedTurn('queued-1')).toMatchObject({
        status: 'cancelled',
        terminalReason: 'converted-to-intervention',
        revision: 2,
      });
      expect(await store.getMessage('user-queued-1')).toMatchObject({
        id: 'user-queued-1',
        runId: control.activeRun.runId,
        instructionDelivery: {
          kind: 'run-intervention',
          instructionId: 'intervention-adopt-1',
          status: 'pending',
        },
      });

      // An ACK-timeout retry replays the same atomic outcome.
      const replay = await handleSessionLiveCommand(command, undefined, control.context);
      expect(replay).toMatchObject({
        success: true,
        data: {
          intervention: { interventionId: 'intervention-adopt-1' },
          queuedTurn: { queuedTurnId: 'queued-1', status: 'cancelled' },
        },
      });
      expect(armRunIntervention).toHaveBeenCalledTimes(2);

      // A stale revision against a fresh queued turn fails closed.
      await store.createQueuedTurn({
        queuedTurnId: 'queued-2',
        sessionId: session.id,
        userMessageId: 'user-queued-2',
        mode: 'next',
        input: { text: 'Second adjustment' },
        fingerprint: 'fingerprint-queued-2',
        submittedAt: new Date().toISOString(),
      });
      const conflict = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-adopt-2',
          userMessageId: 'user-queued-2',
          input: { text: 'Second adjustment' },
          adoptQueuedTurn: { queuedTurnId: 'queued-2', expectedRevision: 99 },
        },
        undefined,
        control.context,
      );
      expect(conflict).toMatchObject({
        success: false,
        error: 'queued-turn-revision-conflict',
      });
      expect(await store.getQueuedTurn('queued-2')).toMatchObject({ status: 'pending' });
    } finally {
      store.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('edits and cancels only a still-pending intervention revision', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-intervention-edit-'));
    const baseSession = createDelayedSessionHandle();
    const armRunIntervention = vi.fn(async () => undefined);
    const cancelRunIntervention = vi.fn(async () => true);
    const session: SessionHandle = {
      ...baseSession,
      armRunIntervention,
      cancelRunIntervention,
    };
    const control = createControlContext(session);
    control.registry.attachRuntimeGeneration(control.activeRun.runId, 'generation-1');
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    control.context.getTranscriptStore = async () => store;

    try {
      await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-edit-1',
          userMessageId: 'user-intervention-edit-1',
          input: { text: 'first instruction' },
        },
        undefined,
        control.context,
      );
      const editResponse = await handleSessionLiveCommand(
        {
          type: 'run/intervention-edit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-edit-1',
          expectedRevision: 1,
          input: { text: 'revised instruction' },
        },
        undefined,
        control.context,
      );
      expect(editResponse).toMatchObject({
        success: true,
        data: { intervention: { revision: 2, input: { text: 'revised instruction' } } },
      });
      expect(armRunIntervention).toHaveBeenLastCalledWith(
        expect.objectContaining({ revision: 2, text: 'revised instruction' }),
      );

      const cancelResponse = await handleSessionLiveCommand(
        {
          type: 'run/intervention-cancel',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-edit-1',
          expectedRevision: 2,
        },
        undefined,
        control.context,
      );
      expect(cancelResponse).toMatchObject({
        success: true,
        data: { intervention: { revision: 3, status: 'cancelled' } },
      });
      expect(cancelRunIntervention).toHaveBeenCalledWith('intervention-edit-1', 2);
      expect(await store.buildHistoryWindow()).toEqual([]);
    } finally {
      store.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('persists a follow-up assembly bound to its user row', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-follow-up-mvl-'));
    const session = createDelayedSessionHandle();
    const { context, activeRun } = createControlContext(session);
    context.piwinRoot = rootDir;
    const recordedPrompts: PromptInput[] = [];
    const pushes: HostPush[] = [];
    context.recordUserPrompt = async (_sessionId, input): Promise<void> => {
      recordedPrompts.push(input);
    };
    context.push = (message: HostPush): void => {
      pushes.push(message);
    };

    try {
      const response = await handleSessionLiveCommand(
        {
          type: 'session/follow_up',
          sessionId: session.id,
          message: 'continue after this tool',
          runId: activeRun.runId,
          clientMessageId: 'client-follow-up-1',
        },
        undefined,
        context,
      );
      expect(response).toMatchObject({ success: true, command: 'session/follow_up' });
      expect(recordedPrompts).toEqual([
        { text: 'continue after this tool', clientMessageId: 'client-follow-up-1' },
      ]);
      const summary = pushes.find((item) => item.type === 'agent/context-summary');
      expect(summary?.type).toBe('agent/context-summary');
      if (summary?.type !== 'agent/context-summary') return;
      expect(summary.requestClass).toBe('follow-up');
      expect(summary.userMessageId).toBe('client-follow-up-1');
      expect(summary.runId).toBe(activeRun.runId);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects stale steer and follow-up requests without calling the session', async () => {
    const session = createDelayedSessionHandle();
    let steerCalls = 0;
    let followUpCalls = 0;
    const sessionWithCounters: SessionHandle = {
      ...session,
      async steer(message: string): Promise<void> {
        steerCalls += 1;
        await session.steer(message);
      },
      async followUp(message: string): Promise<void> {
        followUpCalls += 1;
        await session.followUp(message);
      },
    };
    const { context, activeRun } = createControlContext(sessionWithCounters);

    const steerResponse = await handleSessionLiveCommand(
      {
        type: 'session/steer',
        sessionId: session.id,
        message: 'stale steer',
        runId: 'stale-run',
      },
      undefined,
      context,
    );
    const followUpResponse = await handleSessionLiveCommand(
      {
        type: 'session/follow_up',
        sessionId: session.id,
        message: 'stale follow-up',
        runId: 'stale-run',
      },
      undefined,
      context,
    );

    expect(steerResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });
    expect(followUpResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });
    expect(steerCalls).toBe(0);
    expect(followUpCalls).toBe(0);
    expect(activeRun.runId).not.toBe('stale-run');
  });

  it('requires an active run and explicit owner for follow-up', async () => {
    const session = createDelayedSessionHandle();
    const { context, activeRun, registry } = createControlContext(session);

    const missingRunResponse = await handleSessionLiveCommand(
      {
        type: 'session/follow_up',
        sessionId: session.id,
        message: 'unowned follow-up',
      },
      undefined,
      context,
    );
    expect(missingRunResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });

    registry.terminate(activeRun.runId, 'cancelled', 'cancelled');
    const noActiveRunResponse = await handleSessionLiveCommand(
      {
        type: 'session/follow_up',
        sessionId: session.id,
        message: 'follow-up without active run',
        runId: activeRun.runId,
      },
      undefined,
      context,
    );
    expect(noActiveRunResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('no-active-run'),
    });
  });

  it('acknowledges abort before slow provider and process cleanup settle', async () => {
    const session = createDelayedSessionHandle({
      delays: { cancellationAckMs: 500 },
    });
    const { context, activeRun, registry } = createControlContext(session, 500);
    const startedAt = Date.now();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/abort',
        sessionId: session.id,
        runId: activeRun.runId,
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { cancelled: true, runId: activeRun.runId },
    });
    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(registry.get(activeRun.runId)?.status).toBe('cancelling');
    expect(session.abortRequested).toBe(true);
  });

  it('terminalizes and quarantines a run when the provider abort never settles', async () => {
    const baseSession = createDelayedSessionHandle();
    const session: SessionHandle = {
      ...baseSession,
      async abort(): Promise<void> {
        await new Promise<void>(() => {
          // Provider regression fixture: abort acknowledgement never arrives.
        });
      },
    };
    const { context, activeRun, registry } = createControlContext(session);
    const quarantineSessionRuntime = vi.fn();
    const terminateRun = vi.fn(context.terminateRun);
    context.abortCleanupTimeoutMs = 10;
    context.quarantineSessionRuntime = quarantineSessionRuntime;
    context.terminateRun = terminateRun;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/abort',
        sessionId: session.id,
        runId: activeRun.runId,
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { cancelled: true, runId: activeRun.runId },
    });
    await vi.waitFor(() => {
      expect(registry.get(activeRun.runId)).toMatchObject({
        status: 'cancelled',
        terminalCode: 'cancelled',
        error: expect.stringContaining('fresh runtime'),
      });
    });
    expect(quarantineSessionRuntime).toHaveBeenCalledOnce();
    expect(quarantineSessionRuntime).toHaveBeenCalledWith(session.id, activeRun.runId);
    expect(terminateRun).toHaveBeenCalledWith(
      session.id,
      activeRun.runId,
      'cancelled',
      'cancelled',
      expect.stringContaining('fresh runtime'),
      { skipJobCleanup: true },
    );
    expect(registry.getForegroundRun(session.id)).toBeUndefined();
  });

  it('saves a pause checkpoint and unblocks the run when provider cleanup never settles', async () => {
    const baseSession = createDelayedSessionHandle();
    const session: SessionHandle = {
      ...baseSession,
      async abort(): Promise<void> {
        await new Promise<void>(() => {
          // Provider regression fixture: pause cleanup never acknowledges abort.
        });
      },
    };
    const { context, activeRun, registry } = createControlContext(session);
    // finalizePausedRun touches only these transcript operations in this control fixture.
    const transcriptStore = {
      lastMessageByRole: async () => undefined,
      getRevision: async () => 3,
      createPauseCheckpoint: async (
        input: Parameters<SessionTranscriptStore['createPauseCheckpoint']>[0],
      ) => ({
        ...input,
        checkpointId: 'checkpoint-timeout',
        status: 'active' as const,
      }),
    } as unknown as SessionTranscriptStore;
    context.withTranscriptStore = async (_sessionId, operation) => operation(transcriptStore);
    const quarantineSessionRuntime = vi.fn();
    const terminateRun = vi.fn(context.terminateRun);
    context.abortCleanupTimeoutMs = 10;
    context.quarantineSessionRuntime = quarantineSessionRuntime;
    context.terminateRun = terminateRun;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/pause',
        sessionId: session.id,
        runId: activeRun.runId,
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { state: 'pausing', runId: activeRun.runId },
    });
    await vi.waitFor(() => {
      expect(registry.get(activeRun.runId)).toMatchObject({
        status: 'interrupted',
        terminalCode: 'paused',
        resumeCheckpointId: 'checkpoint-timeout',
        error: expect.stringContaining('fresh runtime'),
      });
    });
    expect(terminateRun).toHaveBeenCalledWith(
      session.id,
      activeRun.runId,
      'paused',
      'paused',
      expect.stringContaining('fresh runtime'),
      { skipJobCleanup: true },
    );
    expect(quarantineSessionRuntime).toHaveBeenCalledWith(session.id, activeRun.runId);
    expect(registry.getForegroundRun(session.id)).toBeUndefined();
  });

  it('returns prompt ack without waiting for delayed preparation', async () => {
    const session = createDelayedSessionHandle();
    const promptContext = createPromptContext(session);
    const { events } = promptContext;
    const context = promptContext.context;
    let releasePreparation: (() => void) | undefined;
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    context.loadTranscriptMessages = async () => {
      await preparationReleased;
      return [];
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'slow preparation' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { sessionId: session.id },
    });
    expect(context.getForegroundRun(session.id)).toBeTruthy();
    expect(
      events
        .filter(
          (message): message is Extract<HostPush, { type: 'run/updated' }> =>
            message.type === 'run/updated',
        )
        .map((message) => message.run.phase),
    ).toEqual(['accepted', 'preparing']);

    releasePreparation?.();
    await session.promptSettled;
  });

  it('passes the foreground Run signal into cold runtime admission', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createPromptContext(session);
    let activation: { runId: string | undefined; signal: AbortSignal | undefined } | undefined;
    context.activateSessionRuntime = async (_sessionId, runId, signal) => {
      activation = { runId, signal };
      return session;
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'signal propagation' },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(activation).toBeDefined());
    if (!activation?.runId || !activation.signal) {
      throw new Error('runtime activation did not receive Run identity and signal');
    }
    expect(activation.signal).toBe(context.getRunSignal(activation.runId));
  });

  it('rebuilds a mismatched warm delegation surface before activating the turn', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createPromptContext(session);
    const order: string[] = [];
    let releasePrepare: (() => void) | undefined;
    context.prepareDelegationRuntime = async (_sessionId, mode) => {
      order.push(`prepare:${mode}`);
      await new Promise<void>((release) => {
        releasePrepare = release;
      });
    };
    context.setRunDelegationMode = (_runId, mode) => {
      order.push(`bind:${mode}`);
    };
    context.activateSessionRuntime = async () => {
      order.push('activate');
      return session;
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'review locally', delegationMode: 'disabled' },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    expect(order).toEqual(['prepare:disabled']);
    releasePrepare?.();
    await vi.waitFor(() => expect(order).toContain('activate'));
    expect(order).toEqual(['prepare:disabled', 'bind:disabled', 'activate']);
  });

  it('cancels preparation and emits one terminal event', async () => {
    const session = createDelayedSessionHandle();
    const promptContext = createPromptContext(session);
    const { events } = promptContext;
    const context = promptContext.context;
    let releasePreparation: (() => void) | undefined;
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    context.loadTranscriptMessages = async () => {
      await preparationReleased;
      return [];
    };

    const promptResponse = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'cancel during preparation' },
      },
      undefined,
      context,
    );
    const acceptedData = promptResponse?.success ? promptResponse.data : undefined;
    const acceptedRunId =
      acceptedData !== null &&
      typeof acceptedData === 'object' &&
      'runId' in acceptedData &&
      typeof acceptedData.runId === 'string'
        ? acceptedData.runId
        : undefined;
    if (acceptedRunId === undefined) {
      throw new Error('prompt did not return accepted run data');
    }

    const abortResponse = await handleSessionLiveCommand(
      {
        type: 'session/abort',
        sessionId: session.id,
        runId: acceptedRunId,
      },
      undefined,
      context,
    );
    expect(abortResponse).toMatchObject({ success: true, data: { cancelled: true } });

    releasePreparation?.();
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    const terminalEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
        message.type === 'run/terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.run).toMatchObject({
      status: 'cancelled',
      terminalCode: 'cancelled',
    });
    expect(context.getForegroundRun(session.id)).toBeUndefined();
    expect(session.emittedDeltaCount).toBe(0);
  });

  it('does not invent a failure when Pi resolves without an error stop reason', async () => {
    const silentSession = createSilentSessionHandle();
    const promptContext = createPromptContext(silentSession);
    const { events } = promptContext;
    const context = promptContext.context;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: silentSession.id,
        input: { text: 'hello' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { sessionId: silentSession.id },
    });

    // Wait for the async prompt path to settle.
    await vi.waitFor(() => {
      expect(context.getForegroundRun(silentSession.id)).toBeUndefined();
    });

    const terminalEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
        message.type === 'run/terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.run).toMatchObject({
      status: 'completed',
    });

    const errorEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'event' }> =>
        message.type === 'event' && message.event.type === 'error',
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('keeps Pi thinking-only stop as a successful native completion', async () => {
    const session = createSilentSessionHandle();
    const promptContext = createPromptContext(session);
    const { events, context } = promptContext;
    context.loadTranscriptMessages = async (sessionId) => {
      const run = context.getForegroundRun(sessionId);
      const runId = run?.runId ?? 'missing-run';
      return [
        {
          id: 'asst-tool',
          role: 'assistant',
          text: '先加载规范',
          createdAt: '2026-08-27T06:25:25.000Z',
          status: 'done',
          runId,
          tools: [
            {
              toolCallId: 't1',
              toolName: 'artifact_instructions',
              status: 'done',
              output: 'ok',
            },
          ],
        },
        {
          id: 'asst-empty-stop',
          role: 'assistant',
          text: '',
          thinking: 'ctx.moveTo(58 80); ctx.',
          createdAt: '2026-08-27T06:34:04.000Z',
          status: 'done',
          runId,
          tools: [],
        },
      ];
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: '给我生成一张2D的鹈鹕骑自行车的HTML动画' },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });

    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    const terminal = events.find(
      (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
        message.type === 'run/terminal',
    );
    expect(terminal?.run).toMatchObject({ status: 'completed' });

    const errorEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'event' }> =>
        message.type === 'event' && message.event.type === 'error',
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('terminalizes failed Agent outcomes with the structured failure', async () => {
    const upstream = 'No endpoints available matching your guardrail restrictions and data policy';
    const failure = {
      code: 'provider-unavailable' as const,
      origin: 'provider' as const,
      message: upstream,
      retriable: true,
      httpStatus: 404,
    };
    const baseSession = createSilentSessionHandle();
    const session: SessionHandle = {
      ...baseSession,
      async prompt() {
        return failedAgentPromptOutcome(failure);
      },
    };
    const promptContext = createPromptContext(session);
    const { events, context } = promptContext;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'hello' },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });

    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    const terminal = events.find(
      (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
        message.type === 'run/terminal',
    );
    expect(terminal?.run).toMatchObject({
      status: 'failed',
      error: upstream,
      agentStopReason: 'error',
      failure,
    });
    const errorEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'event' }> =>
        message.type === 'event' && message.event.type === 'error',
    );
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.event).toMatchObject({
      type: 'error',
      message: upstream,
      failure,
      runId: terminal?.run.runId,
    });
  });

  it('completes Plan mode only after a new durable SessionPlan revision exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-mode-invariant-'));
    const baseSession = createDelayedSessionHandle();
    const planPath = join(rootDir, 'sessions', baseSession.id, 'plan.json');
    const persistingSession: SessionHandle = {
      ...baseSession,
      async prompt() {
        const now = new Date().toISOString();
        await saveSessionPlan(planPath, {
          id: 'plan-mode-plan',
          sessionId: baseSession.id,
          projectPath: '/tmp/project',
          status: 'draft',
          title: 'Durable plan',
          goal: 'Prove Plan mode persistence',
          steps: [{ id: '1', title: 'Verify', status: 'pending' }],
          revision: 0,
          createdAt: now,
          updatedAt: now,
          source: 'skill',
          skillId: 'writing-plans',
        });
        return COMPLETED_STOP_OUTCOME;
      },
    };
    const { context, events } = createPromptContext(persistingSession);
    context.piwinRoot = rootDir;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: persistingSession.id,
        input: { text: 'Plan the change', skillId: 'writing-plans' },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => {
      expect(context.getForegroundRun(persistingSession.id)).toBeUndefined();
    });

    expect(await loadSessionPlan(planPath)).toMatchObject({
      id: 'plan-mode-plan',
      status: 'draft',
      revision: 0,
    });
    expect(
      events.some(
        (message) => message.type === 'run/terminal' && message.run.status === 'completed',
      ),
    ).toBe(true);
  });

  it('session/foreground-run reports the active run, then null after it terminates', async () => {
    const session = createDelayedSessionHandle();
    const { context, registry, activeRun } = createControlContext(session);

    const active = await handleSessionLiveCommand(
      { type: 'session/foreground-run', sessionId: session.id },
      undefined,
      context,
    );
    expect(active).toMatchObject({
      type: 'response',
      success: true,
      data: { sessionId: session.id, run: { runId: activeRun.runId } },
    });

    registry.terminate(activeRun.runId, 'completed');
    const cleared = await handleSessionLiveCommand(
      { type: 'session/foreground-run', sessionId: session.id },
      undefined,
      context,
    );
    expect(cleared).toMatchObject({
      type: 'response',
      success: true,
      data: { sessionId: session.id, run: null },
    });
  });

  it('publishes the replacement generation after reload', async () => {
    const session = createDelayedSessionHandle();
    const { context, registry, activeRun } = createControlContext(session);
    registry.clear();
    const revision = 'rev-1';
    context.runtimeController.attachGeneration(session.id, 'gen-1', revision);
    context.runtimeController.recordSettingsChange(session.id, ['providers']);

    const response = await handleSessionLiveCommand(
      {
        type: 'session/reload-runtime',
        sessionId: session.id,
        expectedSettingsRevision: revision,
        when: 'now',
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: {
        generationId: 'generation-2',
        settingsRevision: 'rev-2',
        state: 'active',
      },
    });
  });

  describe('ORCH orchestration scheme on session/prompt', () => {
    it('fails closed on unknown scheme id before accepting the run', async () => {
      const session = createDelayedSessionHandle();
      const { context } = createPromptContext(session);
      context.listKnownSubagentProfileIds = async () => ['explorer', 'reviewer'];
      context.loadConfig = async () =>
        ({
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
        }) as any;

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'hello', orchestrationSchemeId: 'nope' },
        },
        undefined,
        context,
      );

      expect(response).toMatchObject({
        success: false,
        error: expect.stringContaining('unknown orchestration scheme'),
      });
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    it('injects model-facing preamble and binds turn scheme; transcript keeps user text', async () => {
      const session = createDelayedSessionHandle();
      const promptContext = createPromptContext(session);
      const context = promptContext.context;
      const recordedPrompts: PromptInput[] = [];
      const boundSchemes: Array<ResolvedOrchestrationScheme | undefined> = [];
      let modelFacingText = '';

      context.listKnownSubagentProfileIds = async () => [
        'explorer',
        'reviewer',
        'implementer',
        'tester',
      ];
      context.loadConfig = async () =>
        ({
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
        }) as any;
      context.recordUserPrompt = async (_sessionId, input): Promise<void> => {
        // Snapshot values so later model-facing rewrites cannot alias-mutate the record.
        recordedPrompts.push({
          text: input.text,
          ...(input.orchestrationSchemeId
            ? { orchestrationSchemeId: input.orchestrationSchemeId }
            : {}),
        });
      };
      context.setRunOrchestrationScheme = (runId, scheme): void => {
        boundSchemes.push(scheme);
        if (scheme) {
          context.getRunOrchestrationScheme = () => scheme;
        } else {
          context.getRunOrchestrationScheme = () => undefined;
        }
        void runId;
      };
      const originalPrompt = session.prompt.bind(session);
      session.prompt = async (input: PromptInput) => {
        modelFacingText = input.text;
        return originalPrompt(input);
      };

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'find the bug', orchestrationSchemeId: 'ultra-code' },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);

      await session.promptSettled;
      await vi.waitFor(() => {
        expect(modelFacingText).toContain('[piwin-scheme:ultra-code]');
      });

      expect(recordedPrompts).toHaveLength(1);
      expect(recordedPrompts[0]?.text).toBe('find the bug');
      expect(recordedPrompts[0]?.text).not.toContain('[piwin-scheme:');
      expect(modelFacingText).toContain('find the bug');
      expect(modelFacingText.startsWith('[piwin-scheme:ultra-code]')).toBe(true);
      expect(boundSchemes.some((scheme) => scheme?.schemeId === 'ultra-code')).toBe(true);
    });

    it('marks a pinned role unavailable when its configured model is missing', async () => {
      const session = createDelayedSessionHandle();
      const { context } = createPromptContext(session);
      let boundScheme: ResolvedOrchestrationScheme | undefined;
      context.listKnownSubagentProfileIds = async () => ['explorer'];
      context.loadConfig = async () =>
        ({
          providers: [
            {
              id: 'configured',
              protocol: 'openai-compatible',
              name: 'Configured',
              baseUrl: 'https://example.invalid',
              models: [{ id: 'available', name: 'Available' }],
            },
          ],
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
            schemes: [
              {
                id: 'pinned-scout',
                name: 'Pinned scout',
                description: 'Pinned model fallback coverage',
                defaultRole: 'searcher',
                exposeSpawnMetadata: false,
                waitPolicy: 'await-all',
                systemPreamble: 'Delegate searches to the configured scout role.',
                members: [
                  {
                    role: 'searcher',
                    description: 'Search with a pinned model',
                    profileId: 'explorer',
                    model: {
                      protocol: 'openai-compatible',
                      providerId: 'missing',
                      modelId: 'missing',
                    },
                    fallback: 'main',
                  },
                ],
              },
            ],
          },
        }) as any;
      context.setRunOrchestrationScheme = (_runId, scheme): void => {
        boundScheme = scheme;
      };

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'find it', orchestrationSchemeId: 'pinned-scout' },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(boundScheme?.members[0]?.available).toBe(false);
      });
      expect(boundScheme?.members[0]?.unavailableReason).toContain('unconfigured model');
      expect(boundScheme?.members[0]?.fallback).toBe('main');
    });

    it('injects a compact agent-mode marker model-facing only; transcript keeps user text', async () => {
      const session = createDelayedSessionHandle();
      const promptContext = createPromptContext(session);
      const context = promptContext.context;
      const recordedPrompts: PromptInput[] = [];
      let modelFacingText = '';

      context.recordUserPrompt = async (_sessionId, input): Promise<void> => {
        recordedPrompts.push({
          text: input.text,
          ...(input.agentMode ? { agentMode: input.agentMode } : {}),
        });
      };
      const originalPrompt = session.prompt.bind(session);
      session.prompt = async (input: PromptInput) => {
        modelFacingText = input.text;
        return originalPrompt(input);
      };

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'fix the login bug', agentMode: 'agent' },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);

      await session.promptSettled;
      await vi.waitFor(() => {
        expect(modelFacingText).toContain('[piwin-mode:agent]');
      });

      expect(recordedPrompts).toHaveLength(1);
      expect(recordedPrompts[0]?.text).toBe('fix the login bug');
      expect(recordedPrompts[0]?.text).not.toContain('[piwin-mode:');
      expect(modelFacingText).toContain('fix the login bug');
      expect(modelFacingText).not.toContain('Operating contract');
      expect(modelFacingText.startsWith('[piwin-mode:agent]')).toBe(true);
    });

    it('resolves context refs into model-facing prompt only (CM-02)', async () => {
      const session = createDelayedSessionHandle();
      const promptContext = createPromptContext(session);
      const context = promptContext.context;
      const recordedPrompts: PromptInput[] = [];
      let modelFacingText = '';
      const root = await mkdtemp(join(tmpdir(), 'piwin-cm-prompt-'));
      await writeFile(join(root, 'a.ts'), 'export const n = 1;\n', 'utf8');
      // Registered-root gate: the temp project must be a remembered project
      // before host resolves file refs (security: reject unregistered roots).
      context.piwinRoot = root;
      await openOrCreateProject(getPiwinProjectsPath(root), root);

      context.recordUserPrompt = async (_sessionId, input): Promise<void> => {
        recordedPrompts.push(input);
      };
      const originalPrompt = session.prompt.bind(session);
      session.prompt = async (input: PromptInput) => {
        modelFacingText = input.text;
        return originalPrompt(input);
      };

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: {
            text: 'explain the attached selection',
            contextRefs: [
              {
                kind: 'selection',
                relativePath: 'src/a.ts',
                lineStart: 2,
                lineEnd: 4,
                snapshotText: 'const value = 1;',
                label: 'a.ts selection',
              },
              {
                kind: 'file',
                projectPath: root,
                relativePath: 'a.ts',
                lineStart: 1,
                label: 'a.ts',
              },
            ],
          },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);

      await session.promptSettled;
      await vi.waitFor(() => {
        expect(modelFacingText).toContain('<context_ref type="selection" location="src/a.ts:2-4">');
        expect(modelFacingText).toContain('<context_ref type="file" path="a.ts:1">');
        expect(modelFacingText).toContain('export const n = 1;');
      });

      // Transcript records the user's original text; refs only shape model-facing text.
      expect(recordedPrompts).toHaveLength(1);
      expect(recordedPrompts[0]?.text).toBe('explain the attached selection');
      expect(recordedPrompts[0]?.text).not.toContain('[selection-reference:');
      expect(modelFacingText).toContain('explain the attached selection');
    });

    it('clears scheme binding on Off turn (no residual force)', async () => {
      const session = createDelayedSessionHandle();
      const promptContext = createPromptContext(session);
      const context = promptContext.context;
      const boundByRun = new Map<string, ResolvedOrchestrationScheme | undefined>();

      context.listKnownSubagentProfileIds = async () => ['explorer'];
      context.loadConfig = async () =>
        ({
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
        }) as any;
      context.setRunOrchestrationScheme = (runId, scheme): void => {
        boundByRun.set(runId, scheme);
      };

      const ultra = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'with scheme', orchestrationSchemeId: 'ultra-code' },
        },
        undefined,
        context,
      );
      expect(ultra?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(context.getForegroundRun(session.id)).toBeUndefined();
      });

      const off = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'without scheme' },
        },
        undefined,
        context,
      );
      expect(off?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(context.getForegroundRun(session.id)).toBeUndefined();
      });

      const boundValues = [...boundByRun.values()];
      expect(boundValues.some((scheme) => scheme?.schemeId === 'ultra-code')).toBe(true);
      // Off / omit path explicitly clears the run binding.
      expect(boundValues.some((scheme) => scheme === undefined)).toBe(true);
    });
  });
});

function largeModelRef(): import('@piwin/contracts').ModelRef {
  return {
    protocol: 'anthropic-compatible',
    providerId: 'large-provider',
    modelId: 'large-1m',
  };
}

function smallModelRef(): import('@piwin/contracts').ModelRef {
  return {
    protocol: 'openai-compatible',
    providerId: 'small-provider',
    modelId: 'small-252k',
  };
}

function modelSwitchConfig(): import('@piwin/contracts').PiwinConfig {
  const config = createDefaultPiwinConfig();
  return {
    ...config,
    providers: [
      {
        id: 'large-provider',
        protocol: 'anthropic-compatible',
        name: 'Large',
        baseUrl: 'https://large.invalid',
        models: [{ id: 'large-1m', contextWindow: 1_000_000 }],
      },
      {
        id: 'small-provider',
        protocol: 'openai-compatible',
        name: 'Small',
        baseUrl: 'https://small.invalid',
        models: [{ id: 'small-252k', contextWindow: 252_000, maxOutputTokens: 8_000 }],
      },
    ],
  };
}

function assemblyContributionKinds(events: HostPush[]): string[] {
  const summary = [...events]
    .reverse()
    .find(
      (item): item is Extract<HostPush, { type: 'agent/context-summary' }> =>
        item.type === 'agent/context-summary',
    );
  return summary?.contributions.map((item) => item.kind) ?? [];
}

describe('Conversation prompt path (CHT-301~308)', () => {
  it('CHT-302: ignores a stale orchestration id instead of failing closed', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createPromptContext(session);
    context.resolveIsConversationChat = async () => true;
    context.loadConfig = async () =>
      ({
        subagents: {
          profiles: [],
          maxConcurrency: 4,
          maxTasksPerRun: 8,
          processIsolation: 'required',
          parallelWritePolicy: 'worktree-only',
          dirtyBasePolicy: 'ask',
        },
      }) as any;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'hello', orchestrationSchemeId: 'nope' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true, data: { sessionId: session.id } });
    await session.promptSettled;
  });

  it('CHT-303: does not prepare delegation and forces the run to disabled', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createPromptContext(session);
    context.resolveIsConversationChat = async () => true;
    const prepared: Array<'auto' | 'disabled'> = [];
    const bound: Array<'auto' | 'disabled'> = [];
    context.prepareDelegationRuntime = async (_sessionId, mode) => {
      prepared.push(mode);
    };
    context.setRunDelegationMode = (_runId, mode) => {
      bound.push(mode);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'hello', delegationMode: 'auto' },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(bound).toEqual(['disabled']);
    });
    expect(prepared).toEqual([]);
  });

  it('CHT-304/305/308: skips agent increments, clears leftover permission, keeps user-only assembly', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cht-304-'));
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => true;
    context.sessionFilesTouched.set(session.id, '### Files touched\n- src/a.ts');
    const permissionActions: string[] = [];
    context.setSessionPermissionOverride = (): void => {
      permissionActions.push('set');
    };
    context.clearSessionPermissionOverride = (): void => {
      permissionActions.push('clear');
    };
    context.loadConfig = async () =>
      ({
        subagents: {
          profiles: [],
          maxConcurrency: 4,
          maxTasksPerRun: 8,
          processIsolation: 'required',
          parallelWritePolicy: 'worktree-only',
          dirtyBasePolicy: 'ask',
        },
      }) as any;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const now = new Date().toISOString();
    await saveSessionPlan(getPiwinSessionPlanPath(rootDir, session.id), {
      id: 'stale-plan',
      sessionId: session.id,
      projectPath: '/tmp/unused-plan-project',
      status: 'approved',
      title: 'Should stay hidden',
      goal: 'Must not leak into chat',
      steps: [{ id: '1', title: 'Hidden step', status: 'pending' }],
      revision: 1,
      createdAt: now,
      updatedAt: now,
      source: 'user',
    });

    try {
      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: {
            text: 'hello',
            agentMode: 'goal',
            orchestrationSchemeId: 'ultra-code',
            skillId: 'writing-plans',
          },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(modelFacingText).toBe('hello');
      });

      expect(permissionActions).toEqual(['clear']);
      expect(modelFacingText).not.toContain('[piwin-mode:');
      expect(modelFacingText).not.toContain('[piwin-scheme:');
      expect(modelFacingText).not.toContain('Should stay hidden');
      expect(modelFacingText).not.toContain('Files touched');
      expect(assemblyContributionKinds(events)).toEqual(['user']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('CHT-306: still injects explicit contextRefs', async () => {
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.resolveIsConversationChat = async () => true;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingText = input.text;
      return originalPrompt(input);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: {
          text: 'explain this',
          contextRefs: [
            {
              kind: 'selection',
              relativePath: 'src/a.ts',
              lineStart: 2,
              lineEnd: 4,
              snapshotText: 'const value = 1;',
              label: 'a.ts selection',
            },
          ],
        },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(modelFacingText).toContain('<context_ref type="selection" location="src/a.ts:2-4">');
    });
    expect(modelFacingText).toContain('const value = 1;');
    expect(modelFacingText).toContain('explain this');
    expect(assemblyContributionKinds(events)).toEqual(['user', 'context-ref']);
  });

  it('CHT-307: injects cold product history once and re-resolves persisted refs', async () => {
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.resolveIsConversationChat = async () => true;
    let historyPending = true;
    context.needsProductHistoryInjection = () => historyPending;
    context.markProductHistoryInjected = () => {
      historyPending = false;
    };
    context.getTranscriptStore = async () =>
      ({
        buildHistoryWindow: async () => [
          {
            role: 'user',
            text: 'yesterday question',
            contextRefs: [
              {
                kind: 'selection',
                relativePath: 'notes.md',
                lineStart: 1,
                lineEnd: 1,
                snapshotText: 'remember this line',
                label: 'notes selection',
              },
            ],
          },
          { role: 'assistant', text: 'yesterday answer' },
        ],
      }) as unknown as import('@piwin/session').SessionTranscriptStore;
    const modelFacingTexts: string[] = [];
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingTexts.push(input.text);
      return originalPrompt(input);
    };

    const first = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'follow up' },
      },
      undefined,
      context,
    );
    expect(first?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(modelFacingTexts[0]).toContain('[piwin-product-history]');
    });
    expect(modelFacingTexts[0]).toContain('yesterday question');
    expect(modelFacingTexts[0]).toContain('remember this line');
    expect(modelFacingTexts[0]).toContain('follow up');
    expect(modelFacingTexts[0]).not.toContain('[piwin-mode:');
    expect(assemblyContributionKinds(events)).toEqual(['user', 'product-history']);

    const second = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'second turn' },
      },
      undefined,
      context,
    );
    expect(second?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(modelFacingTexts).toHaveLength(2);
    });
    expect(modelFacingTexts[1]).toBe('second turn');
    expect(modelFacingTexts[1]).not.toContain('[piwin-product-history]');
    expect(assemblyContributionKinds(events)).toEqual(['user']);
  });

  it('Project sessions still inject agent mode, plan, and filesTouched', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cht-project-'));
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => false;
    context.sessionFilesTouched.set(session.id, '### Files touched\n- src/a.ts');
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const now = new Date().toISOString();
    await saveSessionPlan(getPiwinSessionPlanPath(rootDir, session.id), {
      id: 'project-plan',
      sessionId: session.id,
      projectPath: '/tmp/project',
      status: 'approved',
      title: 'Visible project plan',
      goal: 'Stay on the agent path',
      steps: [{ id: '1', title: 'Keep injecting', status: 'pending' }],
      revision: 1,
      createdAt: now,
      updatedAt: now,
      source: 'user',
    });

    try {
      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'fix the login bug', agentMode: 'agent' },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(modelFacingText).toContain('[piwin-mode:agent]');
      });
      expect(modelFacingText).toContain('Visible project plan');
      expect(modelFacingText).toContain('Files touched');
      expect(assemblyContributionKinds(events)).toEqual([
        'user',
        'agent-mode',
        'active-plan',
        'files-touched',
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('session/create projectId binding', () => {
  it('persists a durable session from projectId without activating a runtime', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-create-project-id-'));
    const projectPath = join(rootDir, 'repo');
    const created = await openOrCreateProject(
      getPiwinProjectsPath(getPiwinRoot(rootDir)),
      projectPath,
      {
        displayName: 'repo',
      },
    );
    const session = createDelayedSessionHandle();
    const { context } = createControlContext(session);
    context.piwinRoot = rootDir;
    let createSessionCalls = 0;
    context.createSession = async () => {
      createSessionCalls += 1;
      return session;
    };
    let bindCalls = 0;
    context.bindSession = async () => {
      bindCalls += 1;
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/create',
        input: {
          projectId: createRemoteProjectId(created.path),
          sessionName: 'New chat',
        },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true, command: 'session/create' });
    expect(createSessionCalls).toBe(0);
    expect(bindCalls).toBe(0);
    if (!response?.success) {
      throw new Error(response?.error ?? 'session/create failed');
    }
    const sessionId = (response.data as { sessionId: string }).sessionId;
    const record = await getSessionRecord(
      getPiwinSessionIndexPath(getPiwinRoot(rootDir)),
      sessionId,
    );
    expect(record?.projectPath).toBe(created.path);
    expect(record?.name).toBe('New chat');
    await rm(rootDir, { recursive: true, force: true });
  });

  it('returns a create failure when durable persist cannot write', async () => {
    const session = createDelayedSessionHandle();
    const { context } = createControlContext(session);
    const blockerDir = await mkdtemp(join(tmpdir(), 'piwin-create-not-dir-'));
    const blocker = join(blockerDir, 'not-a-directory');
    await writeFile(blocker, 'not-a-directory');
    context.piwinRoot = blocker;
    const disposed: string[] = [];
    context.disposeLiveSession = async (sessionId) => {
      disposed.push(sessionId);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/create',
        input: { scope: { kind: 'general' }, sessionName: 'Conversation' },
      },
      undefined,
      context,
    );

    expect(response).not.toBeNull();
    if (response === null) {
      throw new Error('session/create returned no response');
    }
    expect(response.success).toBe(false);
    expect(response).toMatchObject({
      command: 'session/create',
    });
    expect(disposed).toEqual([]);
    await rm(blockerDir, { recursive: true, force: true });
  });
});

describe('session/tool-output snapshot recovery', () => {
  function snapshotContext(message: import('@piwin/contracts').SessionTranscriptMessage): {
    context: SessionLiveContext;
  } {
    const session = createDelayedSessionHandle();
    const { context } = createControlContext(session);
    context.getTranscriptStore = async () =>
      ({
        getMessage: async (messageId: string) => (messageId === message.id ? message : undefined),
      }) as unknown as import('@piwin/session').SessionTranscriptStore;
    return { context };
  }

  it('returns a bounded tool-snapshot for a filesystem read tool', async () => {
    const message: import('@piwin/contracts').SessionTranscriptMessage = {
      id: 'msg-1',
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'done',
      tools: [
        {
          toolCallId: 'tc-read-1',
          toolName: 'read_file',
          status: 'done',
          output: '# Skill body\n\nRead by the agent.',
          presentation: {
            kind: 'filesystem',
            title: 'Read file',
            actionVerb: 'Read',
            targetPaths: ['/Users/me/.piwin/skills/executing-plans/SKILL.md'],
          },
        },
      ],
    };
    const { context } = snapshotContext(message);

    const response = await handleSessionLiveCommand(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-1',
        toolCallId: 'tc-read-1',
      },
      undefined,
      context,
    );

    if (!response?.success) {
      throw new Error('session/tool-output failed');
    }
    expect(response.data).toMatchObject({
      status: 'ready',
      provenance: 'tool-snapshot',
      output: expect.stringContaining('Read by the agent'),
      truncated: false,
      redacted: false,
    });
  });

  it('returns not-found for a missing message or tool call', async () => {
    const message: import('@piwin/contracts').SessionTranscriptMessage = {
      id: 'msg-missing',
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'done',
    };
    const { context } = snapshotContext(message);

    const missingMessage = await handleSessionLiveCommand(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-absent',
        toolCallId: 'tc-1',
      },
      undefined,
      context,
    );
    if (!missingMessage?.success) {
      throw new Error('session/tool-output failed');
    }
    expect(missingMessage.data).toMatchObject({
      status: 'unavailable',
      reason: 'not-found',
    });

    const missingTool = await handleSessionLiveCommand(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-missing',
        toolCallId: 'tc-absent',
      },
      undefined,
      context,
    );
    if (!missingTool?.success) {
      throw new Error('session/tool-output failed');
    }
    expect(missingTool.data).toMatchObject({
      status: 'unavailable',
      reason: 'not-found',
    });
  });

  it('refuses non-read tools even when they touched files', async () => {
    const message: import('@piwin/contracts').SessionTranscriptMessage = {
      id: 'msg-2',
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'done',
      tools: [
        {
          toolCallId: 'tc-bash-1',
          toolName: 'bash',
          status: 'done',
          output: 'ls /etc/passwd',
          presentation: {
            kind: 'shell',
            title: 'Run command',
            actionVerb: 'Ran command',
            targetPaths: ['/etc/passwd'],
          },
        },
      ],
    };
    const { context } = snapshotContext(message);

    const response = await handleSessionLiveCommand(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-2',
        toolCallId: 'tc-bash-1',
      },
      undefined,
      context,
    );

    if (!response?.success) {
      throw new Error('session/tool-output failed');
    }
    expect(response.data).toMatchObject({
      status: 'unavailable',
      reason: 'not-readable-tool',
    });
  });

  it('redacts secrets at read time', async () => {
    const message: import('@piwin/contracts').SessionTranscriptMessage = {
      id: 'msg-3',
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'done',
      tools: [
        {
          toolCallId: 'tc-read-3',
          toolName: 'read',
          status: 'done',
          output: 'token=sk-abcdef1234567890 and more text',
        },
      ],
    };
    const { context } = snapshotContext(message);

    const response = await handleSessionLiveCommand(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-3',
        toolCallId: 'tc-read-3',
      },
      undefined,
      context,
    );

    if (!response?.success) {
      throw new Error('session/tool-output failed');
    }
    expect(response.data).toMatchObject({
      status: 'ready',
      redacted: true,
    });
    const output = (response.data as { output?: string }).output ?? '';
    expect(output).not.toContain('sk-abcdef1234567890');
  });

  it('bounds output to the requested maxBytes', async () => {
    const message: import('@piwin/contracts').SessionTranscriptMessage = {
      id: 'msg-4',
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'done',
      tools: [
        {
          toolCallId: 'tc-read-4',
          toolName: 'read',
          status: 'done',
          output: 'x'.repeat(4096),
        },
      ],
    };
    const { context } = snapshotContext(message);

    const response = await handleSessionLiveCommand(
      {
        type: 'session/tool-output',
        sessionId: 'session-1',
        messageId: 'msg-4',
        toolCallId: 'tc-read-4',
        maxBytes: 2048,
      },
      undefined,
      context,
    );

    if (!response?.success) {
      throw new Error('session/tool-output failed');
    }
    expect(response.data).toMatchObject({
      status: 'ready',
      truncated: true,
    });
    const output = (response.data as { output?: string }).output ?? '';
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(4096);
  });

  it('does not commit the side-chat version when preparation is cancelled', async () => {
    const session = createDelayedSessionHandle();
    const promptContext = createPromptContext(session);
    const context = promptContext.context;
    const snapshot: import('@piwin/contracts').SideChatContextSnapshot = {
      version: 7,
      capturedAt: '2026-08-12T00:00:00.000Z',
      sourceSessionId: 'parent-1',
      conversation: {
        messageIds: ['source-1'],
        formattedText: 'inherited context',
        truncated: false,
      },
      workspace: {
        scope: 'general',
        workingDirectory: 'general',
      },
      refs: [
        {
          kind: 'main-message',
          sourceSessionId: 'main-1',
          messageId: 'msg-1',
          label: 'Main',
        },
      ],
    };
    context.loadSideChatSnapshot = async () => snapshot;
    let releaseRefLookup: (() => void) | undefined;
    const refLookupReleased = new Promise<void>((resolve) => {
      releaseRefLookup = resolve;
    });
    context.getTranscriptStore = async () => {
      await refLookupReleased;
      return {
        getMessage: async (messageId: string) =>
          messageId === 'msg-1'
            ? {
                id: 'msg-1',
                role: 'assistant',
                text: 'main body',
                createdAt: '2026-08-12T00:00:00.000Z',
                status: 'done',
              }
            : undefined,
      } as unknown as import('@piwin/session').SessionTranscriptStore;
    };

    const promptResponse = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'cancel during side-chat ref resolution' },
      },
      undefined,
      context,
    );
    const acceptedData = promptResponse?.success ? promptResponse.data : undefined;
    const acceptedRunId =
      acceptedData !== null &&
      typeof acceptedData === 'object' &&
      'runId' in acceptedData &&
      typeof acceptedData.runId === 'string'
        ? acceptedData.runId
        : undefined;
    if (acceptedRunId === undefined) {
      throw new Error('prompt did not return accepted run data');
    }

    await handleSessionLiveCommand(
      {
        type: 'session/abort',
        sessionId: session.id,
        runId: acceptedRunId,
      },
      undefined,
      context,
    );
    releaseRefLookup?.();
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    expect(context.sideChatSnapshotInjectedVersions.get(session.id)).toBeUndefined();
  });
});
