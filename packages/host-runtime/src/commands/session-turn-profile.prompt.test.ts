import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelRef, PiwinConfig, PromptInput, SessionHandle } from '@piwin/contracts';
import { COMPLETED_STOP_OUTCOME } from '@piwin/contracts';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import { createDefaultPiwinConfig } from '../config-store.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { createPromptContext } from './session-live-test-context.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sameProviderOld(): ModelRef {
  return {
    protocol: 'openai-compatible',
    providerId: 'acme',
    modelId: 'old-chat',
  };
}

function sameProviderNew(): ModelRef {
  return {
    protocol: 'openai-compatible',
    providerId: 'acme',
    modelId: 'new-chat',
  };
}

function typedSameProvider(): ModelRef {
  return {
    protocol: 'openai-compatible',
    providerId: 'acme',
    modelId: 'typed-chat',
  };
}

function largeModelRef(): ModelRef {
  return {
    protocol: 'anthropic-compatible',
    providerId: 'large-provider',
    modelId: 'large-1m',
  };
}

function smallModelRef(): ModelRef {
  return {
    protocol: 'openai-compatible',
    providerId: 'small-provider',
    modelId: 'small-252k',
  };
}

function composerFollowConfig(): PiwinConfig {
  const config = createDefaultPiwinConfig();
  return {
    ...config,
    providers: [
      {
        id: 'acme',
        protocol: 'openai-compatible',
        name: 'Acme',
        baseUrl: 'https://acme.invalid',
        models: [
          { id: 'old-chat', contextWindow: 200_000 },
          { id: 'new-chat', contextWindow: 200_000 },
          { id: 'typed-chat', contextWindow: 200_000 },
        ],
      },
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

async function seedPromptSession(options: {
  recordModel: ModelRef;
  appliedModel: ModelRef;
  thinkingLevel?: 'off' | 'low' | 'high';
  disabledMcpServerIds?: string[];
}): Promise<{
  session: SessionHandle;
  context: ReturnType<typeof createPromptContext>['context'];
  received: PromptInput[];
  replaceCalls: number[];
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-profile-prompt-'));
  roots.push(rootDir);
  const baseSession = createDelayedSessionHandle();
  const received: PromptInput[] = [];
  const session: SessionHandle = {
    ...baseSession,
    async prompt(input) {
      received.push(input);
      return COMPLETED_STOP_OUTCOME;
    },
  };
  const { context } = createPromptContext(session);
  context.piwinRoot = rootDir;
  context.loadConfig = async () => composerFollowConfig();
  const record = createSessionRecord({
    id: session.id,
    name: 'composer-follow',
    projectPath: '/tmp',
    model: options.recordModel,
    ...(options.thinkingLevel === undefined ? {} : { thinkingLevel: options.thinkingLevel }),
  });
  if (options.disabledMcpServerIds) record.disabledMcpServerIds = options.disabledMcpServerIds;
  await upsertSessionRecord(getPiwinSessionIndexPath(rootDir), record);
  context.sessionModels.set(session.id, options.appliedModel);
  const replaceCalls: number[] = [];
  context.replaceRuntimeForModel = async () => {
    replaceCalls.push(replaceCalls.length + 1);
  };
  return { session, context, received, replaceCalls };
}

describe('session/prompt desired composer profile', () => {
  it('applies record.model on voice-delegation without input.model (same provider)', async () => {
    const { session, context, received, replaceCalls } = await seedPromptSession({
      recordModel: sameProviderNew(),
      appliedModel: sameProviderOld(),
    });

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'from voice', source: 'voice-delegation' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(received).toHaveLength(1);
    expect(received[0]?.model).toEqual(sameProviderNew());
    expect(replaceCalls).toEqual([]);
    expect(context.sessionModels.get(session.id)).toEqual(sameProviderNew());
    const stored = await getSessionRecord(
      getPiwinSessionIndexPath(context.piwinRoot ?? ''),
      session.id,
    );
    expect(stored?.model).toEqual(sameProviderNew());
  });

  it('replaces runtime then prompts with record.model across providers', async () => {
    const order: string[] = [];
    const { session, context, received } = await seedPromptSession({
      recordModel: smallModelRef(),
      appliedModel: largeModelRef(),
    });
    context.replaceRuntimeForModel = async () => {
      order.push('replace-runtime');
    };
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input) => {
      order.push(`prompt:${input.model?.modelId ?? 'default'}`);
      return originalPrompt(input);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'from voice', source: 'voice-delegation' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(order).toEqual(['replace-runtime', 'prompt:small-252k']);
    expect(received[0]?.model).toEqual(smallModelRef());
    expect(context.sessionModels.get(session.id)).toEqual(smallModelRef());
  });

  it('lets explicit input.model win over a different record.model', async () => {
    const { session, context, received, replaceCalls } = await seedPromptSession({
      recordModel: sameProviderNew(),
      appliedModel: sameProviderOld(),
    });

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'typed send', model: typedSameProvider() },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(received[0]?.model).toEqual(typedSameProvider());
    expect(replaceCalls).toEqual([]);
    expect(context.sessionModels.get(session.id)).toEqual(typedSameProvider());
  });

  it('rebuilds the runtime when the session MCP switches changed since it was composed', async () => {
    const { session, context, replaceCalls } = await seedPromptSession({
      recordModel: sameProviderOld(),
      appliedModel: sameProviderOld(),
      disabledMcpServerIds: ['github'],
    });
    const seen: Array<readonly string[] | undefined> = [];
    context.sessionMcpOverrideChanged = (_sessionId, disabledServerIds) => {
      seen.push(disabledServerIds);
      return true;
    };

    const response = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'use fewer tools' } },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(seen).toEqual([['github']]);
    expect(replaceCalls).toEqual([1]);
  });

  it('keeps the live runtime when the session MCP switches are unchanged', async () => {
    const { session, context, replaceCalls } = await seedPromptSession({
      recordModel: sameProviderOld(),
      appliedModel: sameProviderOld(),
    });
    context.sessionMcpOverrideChanged = () => false;

    const response = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'same tools' } },
      undefined,
      context,
    );

    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(replaceCalls).toEqual([]);
  });
});
