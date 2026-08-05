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
    artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 1024 },
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
  it('accepts walkthrough/generate regardless of enabled flag (always-on)', async () => {
    const { context, pushCap } = await createTestContext({
      config: createConfig({
        walkthrough: { ...createDefaultWalkthroughConfig(), enabled: false },
        defaultProviderId: 'prov',
        defaultModelId: 'model-a',
      }),
    });
    const registry = new WalkthroughGenerationRegistry();
    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
    );
    // Walkthrough generation is no longer gated by `enabled`.
    // `enabled` only controls whether a custom prompt is used.
    expect(response.success).toBe(true);
    const pushed = pushCap.pushes.find((m) => m.type === 'walkthrough/updated');
    expect(pushed).toBeTruthy();
    expect(pushed?.artifact?.status).toBe('generating');
  });

  it('accepts walkthrough/generate when enabled and returns generating', async () => {
    const { context, pushCap } = await createTestContext({
      config: createConfig({
        walkthrough: { ...createDefaultWalkthroughConfig(), enabled: true },
        defaultProviderId: 'prov',
        defaultModelId: 'model-a',
      }),
    });
    const registry = new WalkthroughGenerationRegistry();
    const response = await handleWalkthroughGenerate(
      { type: 'walkthrough/generate', sessionId: 'sess-1', messageId: 'msg-1' },
      undefined,
      context,
      registry,
      { fetch: createSuccessFetch('# ok') },
    );
    expect(response.success).toBe(true);
    const data = successData(response) as { status: string };
    expect(data.status === 'generating' || data.status === 'ready').toBe(true);
  });

  it('walkthrough/list returns persisted artifacts for the session', async () => {
    const { context, rootDir } = await createTestContext();
    const { saveWalkthrough } = await import('../walkthrough-store.js');
    const now = new Date().toISOString();
    await saveWalkthrough(rootDir, 'sess-1', {
      version: 1,
      id: 'wt-1',
      sessionId: 'sess-1',
      messageId: 'msg-1',
      mode: 'default',
      sourceHash: 'hash',
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      markdown: '# listed',
      generatedAt: now,
      model: MODEL,
    });

    const listResponse = await handleWalkthroughList(
      { type: 'walkthrough/list', sessionId: 'sess-1' },
      undefined,
      context,
    );
    expect(listResponse.success).toBe(true);
    const data = successData(listResponse) as { artifacts: WalkthroughArtifact[] };
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0]?.status).toBe('ready');
  });

  it('cancel with no in-flight generation reports not aborted', async () => {
    const { context } = await createTestContext();
    const registry = new WalkthroughGenerationRegistry();
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
  });
});
