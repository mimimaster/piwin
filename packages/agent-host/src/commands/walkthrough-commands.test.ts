import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type {
  HostResponse,
  ModelProviderConfig,
  ModelRef,
  PiwinConfig,
  SessionPlan,
  SessionTranscriptDocument,
  SessionTranscriptMessage,
  WalkthroughArtifact,
  WalkthroughConfig,
} from '@piwin/contracts';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';
import {
  handleWalkthroughCancel,
  handleWalkthroughGenerate,
  handleWalkthroughList,
  WalkthroughGenerationRegistry,
  type WalkthroughCommandContext,
} from './walkthrough-commands.js';
import { loadWalkthrough, listWalkthroughs } from '../walkthrough-store.js';
import { getPiwinSessionTranscriptPath } from '../paths.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

// The provider fixture uses `apiKeyEnv: 'TEST_KEY'`. The default secret
// resolver reads process.env, so stub the key here so generation proceeds
// to the (mocked) fetch instead of failing with `missing-credentials`.
process.env.TEST_KEY = 'test-key';

const MODEL: ModelRef = {
  protocol: 'openai-compatible',
  providerId: 'prov',
  modelId: 'model-a',
};

/**
 * Narrow a `HostResponse` to its success variant and return `data`.
 * Throws if the response was a failure, surfacing the error string so
 * test failures point at the unexpected error rather than a type lie.
 */
function successData(response: HostResponse): unknown {
  if (response.success) return response.data;
  throw new Error(`expected success response but got error: ${response.error}`);
}

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'prov',
    name: 'Test provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'TEST_KEY',
    models: [{ id: 'model-a' }],
    ...overrides,
  };
}

function createConfig(
  overrides: {
    walkthrough?: WalkthroughConfig;
    providers?: ModelProviderConfig[];
    defaultProviderId?: string;
    defaultModelId?: string;
  } = {},
): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: overrides.providers ?? [createProvider()],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: { maxBytes: 1024, htmlUiModeDefault: false },
    walkthrough: overrides.walkthrough ?? createDefaultWalkthroughConfig(),
    ...(overrides.defaultProviderId ? { defaultProviderId: overrides.defaultProviderId } : {}),
    ...(overrides.defaultModelId ? { defaultModelId: overrides.defaultModelId } : {}),
  };
}

function makeAssistantMessage(
  overrides: Partial<SessionTranscriptMessage> = {},
): SessionTranscriptMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    text: 'I made the changes.',
    createdAt: '2026-08-01T00:00:00.000Z',
    status: 'done',
    runId: 'run-1',
    endedAt: '2026-08-01T00:00:01.000Z',
    outcome: 'completed',
    model: MODEL,
    ...overrides,
  };
}

function makeUserMessage(text = 'Please fix the bug.'): SessionTranscriptMessage {
  return {
    id: 'user-1',
    role: 'user',
    text,
    createdAt: '2026-08-01T00:00:00.000Z',
    status: 'done',
  };
}

function makeTranscript(messages: SessionTranscriptMessage[]): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId: 'sess-1',
    projectPath: '/proj',
    messages,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

async function writeTranscriptToDisk(
  rootDir: string,
  sessionId: string,
  doc: SessionTranscriptDocument,
): Promise<void> {
  const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
  await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
  await writeFile(transcriptPath, JSON.stringify(doc), 'utf8');
}

type PushedMessage = {
  type: string;
  sessionId?: string;
  artifact?: WalkthroughArtifact;
  level?: string;
  message?: string;
};

type PushCapture = {
  pushes: PushedMessage[];
  push: (message: PushedMessage) => void;
};

function createPushCapture(): PushCapture {
  const pushes: PushedMessage[] = [];
  return {
    pushes,
    push: (message: PushedMessage) => {
      pushes.push(message);
    },
  };
}

type TestContext = {
  rootDir: string;
  pushCap: PushCapture;
  transcriptMessages: SessionTranscriptMessage[];
  config: PiwinConfig;
  plan: SessionPlan | null;
  sessionModel: ModelRef | undefined;
  context: WalkthroughCommandContext;
};

async function createTestContext(
  overrides: {
    messages?: SessionTranscriptMessage[];
    config?: PiwinConfig;
    plan?: SessionPlan | null;
    sessionModel?: ModelRef | undefined;
    persistTranscript?: boolean;
  } = {},
): Promise<TestContext> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-cmd-'));
  const pushCap = createPushCapture();
  const transcriptMessages = overrides.messages ?? [makeUserMessage(), makeAssistantMessage()];
  const config = overrides.config ?? createConfig();
  const plan = overrides.plan === undefined ? null : overrides.plan;
  const sessionModel = overrides.sessionModel;

  if (overrides.persistTranscript !== false) {
    await writeTranscriptToDisk(rootDir, 'sess-1', makeTranscript(transcriptMessages));
  }

  const context: WalkthroughCommandContext = {
    piwinRoot: rootDir,
    push: pushCap.push as WalkthroughCommandContext['push'],
    loadTranscriptMessages: async () => transcriptMessages,
    loadSessionPlan: async () => plan,
    loadConfig: async () => config,
    resolveSessionModel: () => sessionModel,
  };

  return { rootDir, pushCap, transcriptMessages, config, plan, sessionModel, context };
}

/** Fetch mock that returns a valid OpenAI-compatible completion response. */
function createSuccessFetch(text = '# Walkthrough\n\n## Summary\nDone.'): Mock {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: text } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  ) as unknown as Mock;
}

/** Fetch mock that returns a 500 error response. */
function createErrorFetch(status = 500): Mock {
  return vi.fn(
    async () =>
      new Response('internal error', { status, headers: { 'content-type': 'text/plain' } }),
  ) as unknown as Mock;
}

/** Fetch mock that hangs until the abort signal fires, then rejects. */
function createHangingFetch(): { fetch: Mock; abortSeen: Promise<void> } {
  let resolveAbort: () => void;
  const abortSeen = new Promise<void>((resolve) => {
    resolveAbort = resolve;
  });
  const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          resolveAbort();
          reject(new DOMException('aborted', 'AbortError'));
        });
      }
    });
  }) as unknown as Mock;
  return { fetch, abortSeen };
}

/** Collects the artifact from a walkthrough/updated push. */
function latestArtifactPush(
  pushes: PushedMessage[],
  fromIndex = 0,
): WalkthroughArtifact | undefined {
  for (let i = pushes.length - 1; i >= fromIndex; i--) {
    const push = pushes[i];
    if (push?.type === 'walkthrough/updated') {
      return push.artifact;
    }
  }
  return undefined;
}

async function waitForArtifactsOnDisk(
  rootDir: string,
  sessionId: string,
  expectedCount: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const artifacts = await listWalkthroughs(rootDir, sessionId);
    if (artifacts.length >= expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${expectedCount} artifacts on disk`);
}

/** Wait until a walkthrough/updated push with the given status arrives. */
async function waitForPushStatus(
  pushes: PushedMessage[],
  status: WalkthroughArtifact['status'],
  timeoutMs = 2000,
  fromIndex = 0,
): Promise<WalkthroughArtifact> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const artifact = latestArtifactPush(pushes, fromIndex);
    if (artifact && artifact.status === status) {
      return artifact;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for push status '${status}'`);
}

/** Flush microtasks + timers so the async completion pipeline advances. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------ */
/* §15.5 Host command tests                                            */
/* ------------------------------------------------------------------ */

describe('walkthrough-commands — §15.5', () => {
  /* 1. 未开启功能时拒绝生成并返回 `disabled` */
  it('rejects generation when walkthrough is disabled and returns disabled', async () => {
    const disabledConfig = createConfig({
      walkthrough: { ...createDefaultWalkthroughConfig(), enabled: false },
    });
    const { context } = await createTestContext({ config: disabledConfig });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
    );

    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('disabled');
  });

  /* 2. 目标消息不存在返回 `message-not-found` */
  it('returns message-not-found when the target message does not exist', async () => {
    const { context } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'missing-msg' },
      undefined,
      context,
      registry,
    );

    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('message-not-found');
  });

  /* 3. streaming/failed/cancelled 消息返回 `not-eligible` */
  it('returns not-eligible for streaming messages', async () => {
    const streaming = makeAssistantMessage({ status: 'streaming' });
    const { context } = await createTestContext({
      messages: [makeUserMessage(), streaming],
    });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: streaming.id },
      undefined,
      context,
      registry,
    );

    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('not-eligible');
  });

  it('returns not-eligible for failed outcome messages', async () => {
    const failed = makeAssistantMessage({ outcome: 'failed' });
    const { context } = await createTestContext({
      messages: [makeUserMessage(), failed],
    });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: failed.id },
      undefined,
      context,
      registry,
    );

    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('not-eligible');
  });

  it('returns not-eligible for cancelled outcome messages', async () => {
    const cancelled = makeAssistantMessage({ outcome: 'cancelled' });
    const { context } = await createTestContext({
      messages: [makeUserMessage(), cancelled],
    });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: cancelled.id },
      undefined,
      context,
      registry,
    );

    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('not-eligible');
  });

  /* 4. 首次 generate 立即返回 accepted，并发布 generating */
  it('accepts immediately and publishes generating on first generate', async () => {
    const { context, pushCap } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch() },
    );

    expect(response.success).toBe(true);
    const data = successData(response) as {
      status: 'generating';
      generationId: string;
    };
    expect(data.status).toBe('generating');
    expect(data.generationId).toBeTruthy();

    // The generating push was published.
    const generatingPush = latestArtifactPush(pushCap.pushes);
    expect(generatingPush?.status).toBe('generating');
    if (generatingPush?.status === 'generating') {
      expect(generatingPush.generationId).toBe(data.generationId);
      expect(generatingPush.id).toBeTruthy();
    }
  });

  /* 5. completion 成功后发布 ready 并持久化 */
  it('publishes ready and persists the artifact after successful completion', async () => {
    const { context, pushCap, rootDir } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# Walkthrough\n\n## Summary\nAll done.') },
    );

    const ready = await waitForPushStatus(pushCap.pushes, 'ready');
    expect(ready.status).toBe('ready');
    if (ready.status === 'ready') {
      expect(ready.markdown).toContain('All done.');
      expect(ready.model).toEqual(MODEL);
      expect(ready.id).toBeTruthy();
    }

    // Persisted to disk.
    const persisted = await loadWalkthrough(rootDir, 'sess-1', 'msg-1');
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe('ready');
  });

  /* 6. Provider 错误发布 error */
  it('publishes an error artifact when the provider fails', async () => {
    const { context, pushCap } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createErrorFetch(500) },
    );

    const errorArtifact = await waitForPushStatus(pushCap.pushes, 'error');
    expect(errorArtifact.status).toBe('error');
    if (errorArtifact.status === 'error') {
      expect(errorArtifact.error.code).toBe('provider-request-failed');
      // The error message must not contain raw provider body.
      expect(errorArtifact.error.message).not.toContain('internal error');
      expect(errorArtifact.id).toBeTruthy();
    }
  });

  /* 7. 同一消息重复点击不会启动两个生成请求 */
  it('does not start a second generation when one is already in-flight', async () => {
    const { context, pushCap } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();
    const { fetch } = createHangingFetch();

    const first = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch },
    );
    const firstData = successData(first) as { generationId: string };

    const second = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch },
    );
    const secondData = successData(second) as { status: string; generationId: string };

    expect(secondData.status).toBe('generating');
    expect(secondData.generationId).toBe(firstData.generationId);
    // Only one fetch call was made (the second generate did not start a new one).
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  /* 8. `force` 会启动新 generation */
  it('force starts a new generation when none is in-flight', async () => {
    const { context, pushCap, rootDir } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    // First generation completes.
    await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# v1') },
    );
    await waitForPushStatus(pushCap.pushes, 'ready');

    // Force a new generation.
    const before = pushCap.pushes.length;
    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1', force: true },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# v2') },
    );
    const data = successData(response) as { status: string; generationId: string };
    expect(data.status).toBe('generating');

    const ready = await waitForPushStatus(pushCap.pushes, 'ready', 2000, before);
    if (ready.status === 'ready') {
      expect(ready.markdown).toBe('# v2');
    }

    const persisted = await loadWalkthrough(rootDir, 'sess-1', 'msg-1');
    expect(persisted?.status).toBe('ready');
    if (persisted?.status === 'ready') {
      expect(persisted.markdown).toBe('# v2');
    }
  });

  it('force while generating is rejected', async () => {
    const { context } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();
    const { fetch } = createHangingFetch();

    await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch },
    );

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1', force: true },
      undefined,
      context,
      registry,
      { fetch },
    );
    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('invalid-config');
  });

  /* 9. cancel 触发 AbortController 并发布 cancelled */
  it('cancel aborts the in-flight generation', async () => {
    const { context, pushCap } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();
    const { fetch, abortSeen } = createHangingFetch();

    const genResponse = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch },
    );
    const generationId = (successData(genResponse) as { generationId: string }).generationId;

    // Let the fire-and-forget completion pipeline reach the hanging fetch so
    // the abort listener is attached before we cancel. Without this flush the
    // pipeline may still be awaiting loadSessionPlan and the registry entry
    // (which owns the AbortController) would be deleted before the signal is
    // captured, leaving the fetch un-abortable.
    await flush();

    const cancelResponse = await handleWalkthroughCancel(
      { type: 'walkthrough/cancel', sessionId: 'sess-1', messageId: 'msg-1', generationId },
      undefined,
      context,
      registry,
    );
    const cancelData = successData(cancelResponse) as { status: string; aborted: boolean };
    expect(cancelData.status).toBe('cancelled');
    expect(cancelData.aborted).toBe(true);

    // The fetch actually saw the abort signal.
    await abortSeen;

    // The completion pipeline publishes an error(cancelled) artifact.
    const errorArtifact = await waitForPushStatus(pushCap.pushes, 'error');
    if (errorArtifact.status === 'error') {
      expect(errorArtifact.error.code).toBe('cancelled');
    }
  });

  /* 10. 旧 generation 的迟到结果不会覆盖新 generation */
  it('a stale generation result does not overwrite a newer generation', async () => {
    const { context, pushCap, rootDir } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();
    const { fetch } = createHangingFetch();

    // Start a hanging generation.
    const first = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch },
    );
    const firstGenId = (successData(first) as { generationId: string }).generationId;

    // Cancel it, then immediately force a new one that succeeds fast.
    await handleWalkthroughCancel(
      {
        type: 'walkthrough/cancel',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        generationId: firstGenId,
      },
      undefined,
      context,
      registry,
    );
    // Wait for the cancelled generation to publish its error artifact and
    // clean up the registry entry. Waiting for the push (rather than a single
    // flush) is robust under event-loop pressure from the full test suite.
    await waitForPushStatus(pushCap.pushes, 'error');

    const beforeNew = pushCap.pushes.length;
    const newResponse = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1', force: true },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# new result') },
    );
    const newGenId = (successData(newResponse) as { generationId: string }).generationId;
    expect(newGenId).not.toBe(firstGenId);

    const ready = await waitForPushStatus(pushCap.pushes, 'ready', 2000, beforeNew);
    if (ready.status === 'ready') {
      expect(ready.markdown).toBe('# new result');
    }

    // The persisted artifact is the new one, not the stale cancelled one.
    const persisted = await loadWalkthrough(rootDir, 'sess-1', 'msg-1');
    expect(persisted?.status).toBe('ready');
    if (persisted?.status === 'ready') {
      expect(persisted.markdown).toBe('# new result');
    }
  });

  /* 11. SDK 与 RPC Host 都通过同一个 command contract 工作 */
  it('works through the same command contract for both SDK and RPC (seam-based)', async () => {
    // The handlers depend only on WalkthroughCommandContext, not HostRuntime.
    // Simulate an "RPC-like" context with a different session model resolution.
    const { context, pushCap } = await createTestContext({
      sessionModel: { protocol: 'openai-compatible', providerId: 'prov', modelId: 'model-a' },
    });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# via seam') },
    );
    expect(response.success).toBe(true);

    const ready = await waitForPushStatus(pushCap.pushes, 'ready');
    if (ready.status === 'ready') {
      expect(ready.markdown).toBe('# via seam');
    }
  });

  /* 12. 生成不会调用 `SessionHandle.prompt()`、`steer()` 或 `followUp()` */
  it('does not call SessionHandle.prompt/steer/followUp during generation', async () => {
    const { context, pushCap } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    // The WalkthroughCommandContext seam has no prompt/steer/followUp surface.
    // Generation only uses loadTranscriptMessages/loadSessionPlan/loadConfig/
    // resolveSessionModel + push. Verify no session handle methods are invoked
    // by checking the seam type has no such methods (compile-time guarantee)
    // and that completion succeeds without any session handle.
    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch() },
    );
    expect(response.success).toBe(true);
    await waitForPushStatus(pushCap.pushes, 'ready');
    // No push of type 'event' (which would indicate a new agent turn).
    const eventPushes = pushCap.pushes.filter((p) => p.type === 'event');
    expect(eventPushes).toHaveLength(0);
  });

  /* Extra: walkthrough/list returns persisted artifacts */
  it('walkthrough/list returns persisted artifacts for the session', async () => {
    const { context, rootDir } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    // Generate one artifact.
    await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# listed') },
    );
    // Wait for persistence.
    const listPushCap = createPushCapture();
    const listContext: WalkthroughCommandContext = {
      ...context,
      push: listPushCap.push as WalkthroughCommandContext['push'],
    };
    // Wait a tick for the async save to complete.
    await flush();
    await waitForArtifactsOnDisk(rootDir, 'sess-1', 1);

    const listResponse = await handleWalkthroughList(
      { type: 'walkthrough/list', sessionId: 'sess-1' },
      undefined,
      listContext,
    );
    expect(listResponse.success).toBe(true);
    const data = successData(listResponse) as { artifacts: WalkthroughArtifact[] };
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0]?.status).toBe('ready');
  });

  /* Extra: returns existing ready artifact without force (no new generation) */
  it('returns the existing ready artifact without force and does not publish generating', async () => {
    const { context, pushCap } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();

    // First generation succeeds.
    await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# first') },
    );
    await waitForPushStatus(pushCap.pushes, 'ready');
    await flush();

    // Second generate without force returns the existing ready artifact.
    const before = pushCap.pushes.length;
    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# should not run') },
    );
    const data = successData(response) as { status: string; artifact: WalkthroughArtifact };
    expect(data.status).toBe('ready');
    if (data.artifact.status === 'ready') {
      expect(data.artifact.markdown).toBe('# first');
    }
    // No new pushes were emitted.
    expect(pushCap.pushes.length).toBe(before);
  });

  /* Extra: model-unavailable when no model can be resolved */
  it('returns model-unavailable when no model is configured for default mode', async () => {
    const emptyConfig = createConfig({
      providers: [createProvider({ models: [{ id: 'other-model' }] })],
    });
    // Message has no model snapshot, session has no model, no config default.
    const msg = makeAssistantMessage({ model: undefined as unknown as ModelRef });
    const { context } = await createTestContext({
      messages: [makeUserMessage(), msg],
      config: emptyConfig,
      sessionModel: undefined,
    });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: msg.id },
      undefined,
      context,
      registry,
    );
    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('model-unavailable');
  });

  /* Extra: custom mode without a configured model returns model-not-configured */
  it('returns model-not-configured for custom mode without a model', async () => {
    const customConfig = createConfig({
      walkthrough: {
        ...createDefaultWalkthroughConfig(),
        mode: 'custom',
        custom: { model: null, prompt: 'custom prompt' },
      },
    });
    const { context } = await createTestContext({ config: customConfig });
    const registry = new WalkthroughGenerationRegistry();

    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
    );
    expect(response.success).toBe(false);
    const error = JSON.parse((response as { error?: string }).error ?? '{}');
    expect(error.code).toBe('model-not-configured');
  });

  /* Extra: cancel with a stale generationId does not abort the current one */
  it('cancel with a stale generationId does not abort the current generation', async () => {
    const { context } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();
    const { fetch } = createHangingFetch();

    const gen = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch },
    );
    const currentGenId = (successData(gen) as { generationId: string }).generationId;

    const cancelResponse = await handleWalkthroughCancel(
      {
        type: 'walkthrough/cancel',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        generationId: 'stale-id',
      },
      undefined,
      context,
      registry,
    );
    const cancelData = successData(cancelResponse) as { aborted: boolean };
    expect(cancelData.aborted).toBe(false);

    // The current generation is still in-flight.
    expect(registry.get('sess-1', 'msg-1')?.generationId).toBe(currentGenId);
  });
});
