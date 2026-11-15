import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  BackendSessionBlueprint,
  HostToolExecutionPort,
  SessionCapabilitySnapshot,
} from '@piwin/contracts';
import { AgentWorkerSupervisor } from './agent-worker-supervisor.js';
import { InProcessSdkSessionBackend } from './backends/in-process-sdk-session-backend.js';
import type { PiSessionBackend } from './backends/pi-session-backend.js';
import { WorkerSessionBackend } from './backends/worker-rpc-session-backend.js';
import type { SerializableProviderRuntime } from './rpc/serializable-blueprint.js';

type RecordedRequest = {
  model: string | undefined;
  isSummary: boolean;
  systemText: string;
  userText: string;
};

type StubServer = {
  baseUrl: string;
  requests: RecordedRequest[];
  setFailMode: (fail: boolean) => void;
  close: () => Promise<void>;
};

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    if (task) {
      await task().catch(() => undefined);
    }
  }
});

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('\n');
}

function writeOpenAiSse(
  response: ServerResponse,
  modelId: string,
  text: string,
  tokens: { prompt: number; completion: number },
): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (choices: unknown[], usage?: unknown) => ({
    id: 'chatcmpl-compaction-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: modelId,
    choices,
    ...(usage ? { usage } : {}),
  });
  const total = tokens.prompt + tokens.completion;
  response.end(
    [
      `data: ${JSON.stringify(
        chunk([{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]),
      )}`,
      `data: ${JSON.stringify(
        chunk([{ index: 0, delta: {}, finish_reason: 'stop' }], {
          prompt_tokens: tokens.prompt,
          completion_tokens: tokens.completion,
          total_tokens: total,
        }),
      )}`,
      'data: [DONE]',
      '',
    ].join('\n\n'),
  );
}

async function startStubProviderServer(options: {
  replyText: string;
  summaryText: string;
  promptTokens?: number;
  initialFail?: boolean;
}): Promise<StubServer> {
  let shouldFail = options.initialFail === true;
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((request, response) => {
    void readRequestJson(request).then((payload) => {
      const messages = Array.isArray(payload.messages)
        ? (payload.messages as Array<{ role?: string; content?: unknown }>)
        : [];
      const systemText = messages
        .filter((msg) => msg.role === 'system' || msg.role === 'developer')
        .map((msg) => extractMessageText(msg.content))
        .join('\n');
      const userText = messages
        .filter((msg) => msg.role === 'user')
        .map((msg) => extractMessageText(msg.content))
        .join('\n');
      const isSummary =
        systemText.includes('context summarization') ||
        userText.includes('<conversation>') ||
        userText.includes('structured context checkpoint summary');

      requests.push({
        model: typeof payload.model === 'string' ? payload.model : undefined,
        isSummary,
        systemText,
        userText,
      });

      if (shouldFail) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'delegated backend HTTP 400 failure' } }));
        return;
      }

      const modelId = typeof payload.model === 'string' ? payload.model : 'unknown';
      const content = isSummary ? options.summaryText : options.replyText;
      const promptTokens = isSummary ? 300 : (options.promptTokens ?? 100);
      writeOpenAiSse(response, modelId, content, { prompt: promptTokens, completion: 40 });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('stub server did not bind to TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setFailMode(fail: boolean) {
      shouldFail = fail;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function createSnapshot(workingDirectory: string): SessionCapabilitySnapshot {
  return {
    version: 1,
    snapshotId: 'snap-compaction-delegation',
    inputs: {
      rulesRevision: 'r1',
      settingsRevision: 's1',
      projectRevision: 'p1',
      mcpRevision: 'm1',
      resourceCatalogRevision: 'c1',
    },
    scope: { kind: 'general' },
    workingDirectory,
    trust: { kind: 'general' },
    resources: {
      skills: { disabledIds: [], allowedSources: ['user', 'bundled', 'project'], allowlistedIds: null },
      extensions: { disabledIds: [], allowedSources: ['user', 'bundled', 'project'], allowlistedIds: null },
      prompts: { disabledIds: [], allowedSources: ['user', 'bundled', 'project'], allowlistedIds: null },
    },
    resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
    context: {
      allowPiNativeInstructions: false,
      allowProjectAgentsFiles: false,
      allowProjectSystemPrompts: false,
    },
    contextManifest: { agentsFiles: [] },
    tools: {
      hostTools: [],
      piBuiltinToolNames: [],
      enabledFamilies: [],
      enabledMcpServerIds: [],
    },
  };
}

async function createSessionFixture(
  mode: 'sdk' | 'rpc-worker',
  options: { mainPromptTokens?: number; delegateFails?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), `piwin-compaction-delegation-${mode}-`));
  const workDir = join(root, 'work');
  const agentDir = join(root, 'agent');
  cleanupTasks.push(() => rm(root, { recursive: true, force: true }));

  const mainServer = await startStubProviderServer({
    replyText: 'main-model-turn-reply',
    summaryText: 'MAIN-FALLBACK-SUMMARY-MUST-NOT-APPEAR',
    ...(options.mainPromptTokens !== undefined
      ? { promptTokens: options.mainPromptTokens }
      : {}),
  });
  cleanupTasks.push(() => mainServer.close());

  const delegateServer = await startStubProviderServer({
    replyText: 'delegate-should-not-handle-normal-turns',
    summaryText: '## Goal\nDELEGATED-SUMMARY-OK',
    ...(options.delegateFails ? { initialFail: true } : {}),
  });
  cleanupTasks.push(() => delegateServer.close());

  process.env.PIWIN_TEST_COMPACT_MAIN_KEY = 'test-main-key';
  process.env.PIWIN_TEST_COMPACT_DELEGATE_KEY = 'test-delegate-key';

  const providers: SerializableProviderRuntime[] = [
    {
      providerId: 'main-provider',
      protocol: 'openai-compatible',
      baseUrl: mainServer.baseUrl,
      auth: { kind: 'env', envName: 'PIWIN_TEST_COMPACT_MAIN_KEY' },
      models: [
        {
          id: 'main-chat',
          label: 'Main Chat',
          reasoning: false,
          input: ['text'],
          contextWindow: 32_000,
          maxOutputTokens: 2_048,
        },
      ],
    },
    {
      providerId: 'delegate-provider',
      protocol: 'openai-compatible',
      baseUrl: delegateServer.baseUrl,
      auth: { kind: 'env', envName: 'PIWIN_TEST_COMPACT_DELEGATE_KEY' },
      models: [
        {
          id: 'delegate-mini',
          label: 'Delegate Mini',
          reasoning: false,
          input: ['text'],
          contextWindow: 64_000,
          maxOutputTokens: 2_048,
        },
      ],
    },
  ];

  const blueprint: BackendSessionBlueprint = {
    version: 1,
    sessionId: `session-${mode}`,
    runtimeGenerationId: `gen-${mode}`,
    capabilitySnapshot: createSnapshot(workDir),
    model: {
      protocol: 'openai-compatible',
      providerId: 'main-provider',
      modelId: 'main-chat',
    },
    compactionDelegation: {
      model: {
        protocol: 'openai-compatible',
        providerId: 'delegate-provider',
        modelId: 'delegate-mini',
      },
    },
  };

  let backend: PiSessionBackend;
  if (mode === 'sdk') {
    backend = new InProcessSdkSessionBackend({ agentDir });
  } else {
    const workerScript = fileURLToPath(new URL('./rpc-sdk-worker-entry.ts', import.meta.url));
    const supervisor = new AgentWorkerSupervisor({
      worker: { workerScript },
    });
    backend = new WorkerSessionBackend({ supervisor });
    cleanupTasks.push(() => supervisor.dispose());
  }
  cleanupTasks.push(() => backend.dispose());

  const hostToolExecution: HostToolExecutionPort = {
    execute: async () => ({ ok: false, code: 'tool-not-available', message: 'unused' }),
  };

  const handle = await backend.createSession({
    blueprint,
    providers,
    hostToolExecution,
  });

  const events: AgentEvent[] = [];
  const unsubscribe = handle.subscribe((event) => events.push(event));
  cleanupTasks.push(async () => unsubscribe());

  return {
    handle,
    events,
    mainServer,
    delegateServer,
  };
}

describe.each(['sdk', 'rpc-worker'] as const)(
  'compaction delegation end-to-end (%s)',
  (mode) => {
    it('routes manual /compact summarization to the delegated model instead of the main model', async () => {
      const fixture = await createSessionFixture(mode);
      await fixture.handle.setAutoCompactionEnabled?.(false);

      // Seed enough tokens (>20k keepRecentTokens) so Pi has compressible history before cut point.
      await fixture.handle.prompt({ text: `Turn 1 ${'oldest '.repeat(5_000)}`, runId: 'run-1' });
      await fixture.handle.prompt({ text: `Turn 2 ${'recent '.repeat(12_000)}`, runId: 'run-2' });

      const result = await fixture.handle.compact?.('Focus on user decisions');

      expect(result?.ok).toBe(true);
      expect(result?.summary).toContain('DELEGATED-SUMMARY-OK');

      const mainSummaryCalls = fixture.mainServer.requests.filter((req) => req.isSummary);
      const delegateSummaryCalls = fixture.delegateServer.requests.filter((req) => req.isSummary);
      expect(mainSummaryCalls).toHaveLength(0);
      expect(delegateSummaryCalls).toHaveLength(1);
      expect(delegateSummaryCalls[0]?.model).toBe('delegate-mini');
      expect(fixture.delegateServer.requests.filter((req) => !req.isSummary)).toHaveLength(0);
    }, 30_000);

    it('routes automatic compaction summarization to the delegated model', async () => {
      const fixture = await createSessionFixture(mode, { mainPromptTokens: 20_000 });
      await fixture.handle.prompt({ text: `Auto 1 ${'oldest '.repeat(5_000)}`, runId: 'run-auto-1' });
      await fixture.handle.prompt({ text: `Auto 2 ${'recent '.repeat(12_000)}`, runId: 'run-auto-2' });

      const compactionEnd = fixture.events.find((event) => event.type === 'compaction/end');
      expect(compactionEnd).toMatchObject({
        type: 'compaction/end',
        ok: true,
        summary: expect.stringContaining('DELEGATED-SUMMARY-OK'),
      });

      expect(fixture.mainServer.requests.filter((req) => req.isSummary)).toHaveLength(0);
      expect(fixture.delegateServer.requests.filter((req) => req.isSummary).length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('fails explicitly without falling back to the main model when the delegated backend errors', async () => {
      const fixture = await createSessionFixture(mode, { delegateFails: true });
      await fixture.handle.setAutoCompactionEnabled?.(false);

      await fixture.handle.prompt({ text: `Turn 1 ${'oldest '.repeat(5_000)}`, runId: 'run-fail-1' });
      await fixture.handle.prompt({ text: `Turn 2 ${'recent '.repeat(12_000)}`, runId: 'run-fail-2' });

      await expect(fixture.handle.compact?.()).rejects.toThrow(
        /Compaction delegation failed \(delegate-provider\/delegate-mini\)/,
      );

      const compactionEnd = fixture.events.find((event) => event.type === 'compaction/end');
      expect(compactionEnd).toMatchObject({
        type: 'compaction/end',
        ok: false,
        message: expect.stringContaining(
          'Compaction delegation failed (delegate-provider/delegate-mini)',
        ),
      });

      expect(fixture.mainServer.requests.filter((req) => req.isSummary)).toHaveLength(0);
      expect(fixture.delegateServer.requests.filter((req) => req.isSummary).length).toBeGreaterThanOrEqual(1);
    }, 30_000);
  },
);
