import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostPush, HostResponse, ModelRef, PiwinConfig } from '@piwin/contracts';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { createDefaultPiwinConfig } from '../config-store.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import {
  handleSessionComposerProfileCommand,
  type SessionComposerProfileCommandContext,
} from './session-composer-profile-command.js';

const SESSION_ID = 's-composer';
const CHAT_MODEL: ModelRef = { providerId: 'acme', modelId: 'gpt-test' };

function chatConfig(options?: { enabled?: boolean; modelId?: string }): PiwinConfig {
  const config = createDefaultPiwinConfig();
  config.providers = [
    {
      id: 'acme',
      name: 'Acme',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.acme.test/v1',
      enabled: true,
      models: [
        {
          id: options?.modelId ?? 'gpt-test',
          enabled: options?.enabled ?? true,
          capabilities: ['chat'],
        },
      ],
    },
  ];
  return config;
}

function successfulData(response: HostResponse | null): {
  ok: boolean;
  unchanged: boolean;
  session: { model?: ModelRef; thinkingLevel?: string };
} {
  if (response?.success !== true) {
    throw new Error(response === null ? 'missing response' : response.error);
  }
  return response.data as {
    ok: boolean;
    unchanged: boolean;
    session: { model?: ModelRef; thinkingLevel?: string };
  };
}

describe('handleSessionComposerProfileCommand', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function seedSession(options?: {
    model?: ModelRef;
    thinkingLevel?: 'off' | 'low' | 'high';
    loadConfig?: () => Promise<PiwinConfig>;
  }): Promise<{
    piwinRoot: string;
    pushes: HostPush[];
    context: SessionComposerProfileCommandContext;
    sessionModels: Map<string, ModelRef>;
  }> {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-composer-profile-'));
    roots.push(piwinRoot);
    const record = createSessionRecord({
      id: SESSION_ID,
      name: 'composer',
      projectPath: '/tmp',
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
    });
    await upsertSessionRecord(getPiwinSessionIndexPath(piwinRoot), record);
    const pushes: HostPush[] = [];
    const context: SessionComposerProfileCommandContext = {
      piwinRoot,
      push: (message) => {
        pushes.push(message);
      },
      loadConfig: options?.loadConfig ?? (async () => chatConfig()),
    };
    const sessionModels = new Map<string, ModelRef>([
      [SESSION_ID, { providerId: 'applied', modelId: 'last-applied' }],
    ]);
    return { piwinRoot, pushes, context, sessionModels };
  }

  function assertSessionModelsUntouched(sessionModels: Map<string, ModelRef>): void {
    expect(sessionModels.get(SESSION_ID)).toEqual({
      providerId: 'applied',
      modelId: 'last-applied',
    });
  }

  it('sets model on the index record and pushes session/index-updated', async () => {
    const { piwinRoot, pushes, context, sessionModels } = await seedSession();

    const response = await handleSessionComposerProfileCommand(
      { type: 'session/set-composer-profile', sessionId: SESSION_ID, model: CHAT_MODEL },
      'req-1',
      context,
    );

    const data = successfulData(response);
    expect(data.ok).toBe(true);
    expect(data.unchanged).toBe(false);
    expect(data.session.model).toEqual(CHAT_MODEL);
    const stored = await getSessionRecord(getPiwinSessionIndexPath(piwinRoot), SESSION_ID);
    expect(stored?.model).toEqual(CHAT_MODEL);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      type: 'session/index-updated',
      op: 'updated',
      sessionId: SESSION_ID,
      session: { id: SESSION_ID, model: CHAT_MODEL },
    });
    assertSessionModelsUntouched(sessionModels);
  });

  it('treats a second identical set as success without an extra push', async () => {
    const { pushes, context, sessionModels } = await seedSession();
    const command = {
      type: 'session/set-composer-profile' as const,
      sessionId: SESSION_ID,
      model: CHAT_MODEL,
    };

    const first = await handleSessionComposerProfileCommand(command, 'req-1', context);
    expect(successfulData(first).unchanged).toBe(false);
    expect(pushes).toHaveLength(1);

    const second = await handleSessionComposerProfileCommand(command, 'req-2', context);
    const data = successfulData(second);
    expect(data.ok).toBe(true);
    expect(data.unchanged).toBe(true);
    expect(data.session.model).toEqual(CHAT_MODEL);
    expect(pushes).toHaveLength(1);
    assertSessionModelsUntouched(sessionModels);
  });

  it('fails unknown session without pushing', async () => {
    const { piwinRoot, pushes, context, sessionModels } = await seedSession();

    const response = await handleSessionComposerProfileCommand(
      {
        type: 'session/set-composer-profile',
        sessionId: 'missing-session',
        model: CHAT_MODEL,
      },
      'req-unknown',
      context,
    );

    expect(response?.success).toBe(false);
    expect(response?.success === false ? response.error : '').toBe(
      'Unknown session: missing-session',
    );
    expect(pushes).toHaveLength(0);
    expect(await getSessionRecord(getPiwinSessionIndexPath(piwinRoot), SESSION_ID)).toMatchObject({
      id: SESSION_ID,
    });
    expect(
      (await getSessionRecord(getPiwinSessionIndexPath(piwinRoot), SESSION_ID))?.model,
    ).toBeUndefined();
    assertSessionModelsUntouched(sessionModels);
  });

  it('fails disabled or missing models without rewriting the index', async () => {
    const seeded = {
      model: { providerId: 'acme', modelId: 'kept' } satisfies ModelRef,
    };
    const disabled = await seedSession({
      ...seeded,
      loadConfig: async () => chatConfig({ enabled: false }),
    });
    const disabledResponse = await handleSessionComposerProfileCommand(
      { type: 'session/set-composer-profile', sessionId: SESSION_ID, model: CHAT_MODEL },
      'req-disabled',
      disabled.context,
    );
    expect(disabledResponse?.success).toBe(false);
    expect(disabledResponse?.success === false ? disabledResponse.error : '').toBe(
      'model-unavailable: acme/gpt-test is not an enabled chat model',
    );
    expect(disabled.pushes).toHaveLength(0);
    expect(
      (await getSessionRecord(getPiwinSessionIndexPath(disabled.piwinRoot), SESSION_ID))?.model,
    ).toEqual(seeded.model);
    assertSessionModelsUntouched(disabled.sessionModels);

    const missing = await seedSession({
      ...seeded,
      loadConfig: async () => chatConfig({ modelId: 'other-chat' }),
    });
    const missingResponse = await handleSessionComposerProfileCommand(
      { type: 'session/set-composer-profile', sessionId: SESSION_ID, model: CHAT_MODEL },
      'req-missing',
      missing.context,
    );
    expect(missingResponse?.success).toBe(false);
    expect(missingResponse?.success === false ? missingResponse.error : '').toBe(
      'model-unavailable: acme/gpt-test is not an enabled chat model',
    );
    expect(missing.pushes).toHaveLength(0);
    expect(
      (await getSessionRecord(getPiwinSessionIndexPath(missing.piwinRoot), SESSION_ID))?.model,
    ).toEqual(seeded.model);
    assertSessionModelsUntouched(missing.sessionModels);
  });

  it('updates thinkingLevel only and leaves model untouched', async () => {
    const existingModel: ModelRef = { providerId: 'acme', modelId: 'gpt-test' };
    const { piwinRoot, pushes, context, sessionModels } = await seedSession({
      model: existingModel,
      thinkingLevel: 'low',
    });

    const response = await handleSessionComposerProfileCommand(
      {
        type: 'session/set-composer-profile',
        sessionId: SESSION_ID,
        thinkingLevel: 'high',
      },
      'req-think',
      context,
    );

    const data = successfulData(response);
    expect(data.ok).toBe(true);
    expect(data.unchanged).toBe(false);
    expect(data.session.thinkingLevel).toBe('high');
    expect(data.session.model).toEqual(existingModel);
    const stored = await getSessionRecord(getPiwinSessionIndexPath(piwinRoot), SESSION_ID);
    expect(stored?.thinkingLevel).toBe('high');
    expect(stored?.model).toEqual(existingModel);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      type: 'session/index-updated',
      op: 'updated',
      sessionId: SESSION_ID,
      session: { thinkingLevel: 'high', model: existingModel },
    });
    assertSessionModelsUntouched(sessionModels);
  });

  it('fails when neither model nor thinkingLevel is present', async () => {
    const { piwinRoot, pushes, context, sessionModels } = await seedSession({
      model: CHAT_MODEL,
    });

    const response = await handleSessionComposerProfileCommand(
      { type: 'session/set-composer-profile', sessionId: SESSION_ID },
      'req-empty',
      context,
    );

    expect(response?.success).toBe(false);
    expect(response?.success === false ? response.error : '').toBe(
      'model or thinkingLevel is required',
    );
    expect(pushes).toHaveLength(0);
    expect(
      (await getSessionRecord(getPiwinSessionIndexPath(piwinRoot), SESSION_ID))?.model,
    ).toEqual(CHAT_MODEL);
    assertSessionModelsUntouched(sessionModels);
  });

  it('returns null for other command types', async () => {
    const { context } = await seedSession();
    const response = await handleSessionComposerProfileCommand(
      { type: 'session/rename', sessionId: SESSION_ID, name: 'nope' },
      'req-other',
      context,
    );
    expect(response).toBeNull();
  });
});
