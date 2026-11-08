import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, BackendSessionBlueprint } from '@piwin/contracts';
import { InProcessSdkSessionBackend } from './backends/in-process-sdk-session-backend.js';
import { WorkerSessionBackend } from './backends/worker-rpc-session-backend.js';
import { AgentWorkerSupervisor } from './agent-worker-supervisor.js';
import type { SerializableProviderRuntime } from './rpc/serializable-blueprint.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Scenario = 'tool-burst' | 'zero-usage';
type RequestMessage = { role: string; content?: unknown };
type LocalRequest = { messages: RequestMessage[] };

function complete(response: ServerResponse, content: string, toolCall: boolean, tokens: number): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = toolCall
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'large-result-1', type: 'function', function: { name: 'large', arguments: '{}' } }] }
    : { role: 'assistant', content };
  const chunk = (choices: unknown[], usage?: unknown) => ({
    id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'synthetic', choices,
    ...(usage ? { usage } : {}),
  });
  response.write(`data: ${JSON.stringify(chunk([{ index: 0, delta, finish_reason: null }]))}\n\n`);
  const outputTokens = tokens === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4));
  response.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }], {
    prompt_tokens: tokens, completion_tokens: outputTokens, total_tokens: tokens + outputTokens,
  }))}\n\n`);
  response.end('data: [DONE]\n\n');
}

async function createLocalProvider(scenario: Scenario): Promise<{
  url: string; order: string[]; requests: LocalRequest[];
}> {
  const order: string[] = [];
  const requests: LocalRequest[] = [];
  let conversationalRequests = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as LocalRequest;
      const system = body.messages.filter((message) => message.role === 'system' || message.role === 'developer');
      const summary = JSON.stringify(system).includes('context summarization assistant');
      const tokens = Math.ceil(JSON.stringify(body.messages.filter((message) => message.role !== 'system' && message.role !== 'developer')).length / 4);
      if (summary) {
        order.push('summary');
        complete(response, 'Synthetic summary preserving the current task.', false, 20);
        return;
      }
      conversationalRequests += 1;
      order.push(`request:${tokens}`);
      requests.push(body);
      if (conversationalRequests <= 2) {
        complete(response, 'Seed response ' + 'seed '.repeat(1600), false, scenario === 'zero-usage' ? 0 : tokens);
      } else if (scenario === 'tool-burst' && conversationalRequests === 3) {
        complete(response, '', true, tokens);
      } else {
        complete(response, 'Synthetic task completed.', false, scenario === 'zero-usage' ? 0 : tokens);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('local provider did not listen');
  return { url: `http://127.0.0.1:${address.port}/v1`, order, requests };
}

function createBlueprint(workingDirectory: string): BackendSessionBlueprint {
  return {
    version: 1, sessionId: 'auto-compact-session', runtimeGenerationId: 'auto-compact-generation',
    model: { providerId: 'synthetic', modelId: 'synthetic', protocol: 'openai-compatible' },
    capabilitySnapshot: {
      version: 1, snapshotId: 'auto-compact-snapshot', workingDirectory,
      inputs: { rulesRevision: '1', settingsRevision: '1', projectRevision: '1', mcpRevision: '1', resourceCatalogRevision: '1' },
      trust: { kind: 'general' }, scope: { kind: 'general' },
      resources: {
        skills: { disabledIds: [], allowedSources: [], allowlistedIds: null },
        extensions: { disabledIds: [], allowedSources: [], allowlistedIds: null },
        prompts: { disabledIds: [], allowedSources: [], allowlistedIds: null },
      },
      resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
      context: { allowPiNativeInstructions: false, allowProjectAgentsFiles: false, allowProjectSystemPrompts: false },
      contextManifest: { agentsFiles: [] },
      tools: {
        hostTools: [{ name: 'large', description: 'Synthetic large tool output', parameters: { type: 'object', properties: {} } }],
        piBuiltinToolNames: [], enabledFamilies: [], enabledMcpServerIds: [],
      },
    },
  };
}

async function createFixture(mode: 'sdk' | 'rpc-worker', scenario: Scenario, enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'piwin-auto-compaction-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent');
  await mkdir(agentDir);
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
    compaction: { enabled, reserveTokens: 2000, keepRecentTokens: 2000 }, retry: { enabled: false },
  }));
  const provider = await createLocalProvider(scenario);
  const supervisor = new AgentWorkerSupervisor({ settings: { startupTimeoutMs: 15_000 } });
  const backend = mode === 'sdk'
    ? new InProcessSdkSessionBackend({ agentDir })
    : new WorkerSessionBackend({
        supervisor, disposeSupervisor: true,
        worker: {
          workerScript: fileURLToPath(new URL('./rpc-sdk-worker-entry.ts', import.meta.url)),
          nodeArgs: ['--import', 'tsx'], env: { PIWIN_PI_AGENT_DIR: agentDir },
        },
      });
  cleanups.push(() => backend.dispose());
  const auth: SerializableProviderRuntime['auth'] = mode === 'sdk'
    ? { kind: 'inline', apiKey: 'synthetic-test-key' }
    : { kind: 'bootstrap', secretId: 'synthetic-secret' };
  const events: AgentEvent[] = [];
  let toolExecutions = 0;
  const session = await backend.createSession({
    blueprint: createBlueprint(root),
    providers: [{
      providerId: 'synthetic', protocol: 'openai-compatible', baseUrl: provider.url, auth,
      models: [{ id: 'synthetic', contextWindow: 14_000, maxOutputTokens: 1000 }],
    }],
    ...(mode === 'rpc-worker' ? { providerSecrets: [{ secretId: 'synthetic-secret', value: 'synthetic-test-key' }] } : {}),
    hostToolExecution: { execute: async () => {
      toolExecutions += 1;
      provider.order.push('tool');
      return { ok: true, output: 'large '.repeat(4667) };
    } },
  });
  const unsubscribe = session.subscribe((event) => events.push(event));
  cleanups.push(async () => unsubscribe());
  let runOrdinal = 0;
  const prompt = (text: string) => session.prompt({ text, runId: `run-${++runOrdinal}` });
  return { ...provider, session, events, prompt, getToolExecutions: () => toolExecutions };
}

for (const mode of ['sdk', 'rpc-worker'] as const) {
  describe(`automatic compaction through ${mode}`, () => {
    it('compacts a tool burst before sending the next assistant request', async () => {
      const fixture = await createFixture(mode, 'tool-burst');
      await fixture.prompt('Seed one ' + 'user '.repeat(1600));
      await fixture.prompt('Seed two ' + 'user '.repeat(1600));
      const outcome = await fixture.prompt('Run the synthetic tool.');
      expect(outcome.status).toBe('completed');
      expect(fixture.getToolExecutions()).toBe(1);
      const toolIndex = fixture.order.indexOf('tool');
      expect(toolIndex).toBeGreaterThan(0);
      expect(fixture.order[toolIndex + 1]).toBe('summary');
      const nextRequest = fixture.order.slice(toolIndex + 1).find((item) => item.startsWith('request:'));
      expect(Number(nextRequest?.split(':')[1])).toBeLessThan(14_000);
      expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'compaction/end', ok: true }));
    }, 30_000);

    it('automatically compacts estimated history when the provider reports zero usage', async () => {
      const fixture = await createFixture(mode, 'zero-usage');
      await fixture.prompt('Seed one ' + 'user '.repeat(4000));
      await fixture.prompt('Seed two ' + 'user '.repeat(3200));
      expect(fixture.order).toContain('summary');
      expect(fixture.events).toContainEqual(expect.objectContaining({ type: 'compaction/end', ok: true }));
      const summaries = fixture.order.filter((item) => item === 'summary').length;
      await fixture.prompt('Continue with the short summary.');
      expect(fixture.order.filter((item) => item === 'summary')).toHaveLength(summaries);
    }, 30_000);

    it('respects disabled automatic compaction', async () => {
      const fixture = await createFixture(mode, 'zero-usage', false);
      await fixture.prompt('Seed one ' + 'user '.repeat(4000));
      await fixture.prompt('Seed two ' + 'user '.repeat(3200));
      expect(fixture.order).not.toContain('summary');
      expect(fixture.events.some((event) => event.type === 'compaction/start')).toBe(false);
    }, 30_000);
  });
}
