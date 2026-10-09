/** No-secret loopback model; all session, JSONL, Host port and sandbox code is production. */
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentWorkerSupervisor,
  InProcessSdkSessionBackend,
  PIWIN_PI_AGENT_DIR_ENV,
  WorkerSessionBackend,
  type PiSessionBackend,
} from '@piwin/agent-host';
import type {
  AgentEvent,
  HostToolExecutionContext,
  HostToolExecutionInput,
  HostToolExecutionResult,
  HostToolRegistration,
} from '@piwin/contracts';
import { compileBlueprintForWorker } from '../blueprint-compiler.js';
import { createDefaultPiwinConfig } from '../config-store.js';
import { buildSessionHostTools, descriptorsFromTools } from '../tools/build-session-host-tools.js';
import { createSessionHostToolExecutionPort } from '../tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from '../tools/tool-admission.js';
import { toolFamilyIndex } from '../tools/tool-family-index.js';

export const MODEL = {
  protocol: 'openai-compatible' as const,
  providerId: 'codemode-fixture',
  modelId: 'codemode-fixture-model',
};
export const SESSION = 'codemode-session';
export const GENERATION = 'codemode-generation';
export const RUN = 'codemode-run';
export const RAW_PARENT = 'model-parent';
export const FILLER = 'structured-only-'.repeat(8);
export type Mode = 'sdk' | 'rpc';

type ModelRequest = {
  model: string;
  tools?: Array<{ function: { name: string; parameters: unknown } }>;
  messages: Array<{ role: string; content: unknown; tool_call_id?: string }>;
};

async function startModel(code: string, enabled: boolean) {
  const requests: ModelRequest[] = [];
  const errors: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        throw new Error(`unexpected model request: ${request.method} ${request.url}`);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString()) as ModelRequest);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (enabled && requests.length === 1) {
        chunk(response, {
          role: 'assistant',
          tool_calls: [{ index: 0, id: RAW_PARENT, type: 'function',
            function: { name: 'piwin_codemode', arguments: JSON.stringify({ code }) } }],
        });
        chunk(response, {}, 'tool_calls');
      } else {
        chunk(response, { role: 'assistant', content: 'Fixture complete.' });
        chunk(response, {}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    })().catch((error: unknown) => {
      errors.push(error);
      response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
  return {
    requests, errors,
    isListening: () => server.listening,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function chunk(response: ServerResponse, delta: Record<string, unknown>, finishReason: string | null = null) {
  response.write(`data: ${JSON.stringify({
    id: 'chatcmpl-codemode', object: 'chat.completion.chunk', created: 1, model: MODEL.modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`);
}

function readTool(name: string, execute: HostToolRegistration['execute']): HostToolRegistration {
  return {
    descriptor: { name, description: `Read-only fixture ${name}`, parameters: { type: 'object', properties: {} } },
    family: 'filesystem-read',
    permissionSpec: { action: 'filesystem:read', risk: 'unknown', rememberable: false, readOnly: true },
    fileEffect: { kind: 'none' },
    execute,
  };
}

export async function openCodemodeBackend(mode: Mode, code: string, enabled = true) {
  const root = await mkdtemp(join(tmpdir(), `piwin-codemode-${mode}-`));
  const model = await startModel(code, enabled).catch(async (error: unknown) => {
    await rm(root, { recursive: true, force: true });
    throw error;
  });
  const agentDir = join(root, 'pi-agent');
  const project = join(root, 'project');
  const supervisor = new AgentWorkerSupervisor({ settings: { startupTimeoutMs: 15_000 } });
  let backend: PiSessionBackend | undefined;
  const port = createSessionHostToolExecutionPort({
    isSessionKnown: (id) => id === SESSION,
    getRuntimeGenerationId: (id) => id === SESSION ? GENERATION : undefined,
    isRunAdmitted: (run, session, generation) => run === RUN && session === SESSION && generation === GENERATION,
  });
  const inputs: HostToolExecutionInput[] = [];
  const results: Array<{ input: HostToolExecutionInput; result: HostToolExecutionResult }> = [];
  const contexts: HostToolExecutionContext[] = [];
  let resolveStarted!: () => void;
  let resolveAborted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const aborted = new Promise<void>((resolve) => { resolveAborted = resolve; });
  // Transparent observer, never an alternative executor. Nested and backend calls
  // both delegate to this exact registered/restricted SessionHostToolExecutionPort.
  const observedPort = {
    readActiveRegistrations: port.readActiveRegistrations.bind(port),
    execute: async (input: HostToolExecutionInput, signal: AbortSignal) => {
      inputs.push(input);
      const result = await port.execute(input, signal);
      results.push({ input, result });
      return result;
    },
  };
  const close = async () => {
    try { await backend?.dispose(); }
    finally {
      try { await supervisor.dispose(); }
      finally {
        port.clear();
        try { await model.close(); }
        finally { await rm(root, { recursive: true, force: true }); }
      }
    }
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(agentDir, 'auth.json'), '{}');
    await writeFile(join(agentDir, 'models.json'), '{}');
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
      defaultTools: [], retry: { enabled: false }, autoCompaction: { enabled: false },
    }));
    const dataset = Array.from({ length: 2_000 }, (_, id) => ({ id, tag: id % 2 ? 'odd' : 'even', filler: FILLER }));
    const serialized = JSON.stringify(dataset);
    const datasetPath = join(project, 'rows.json');
    await writeFile(datasetPath, serialized);
    const config = {
      ...createDefaultPiwinConfig(),
      providers: [{ id: MODEL.providerId, name: 'Local fixture', protocol: MODEL.protocol,
        baseUrl: model.baseUrl, apiKeyRef: 'test-only-key',
        models: [{ id: MODEL.modelId, label: 'Fixture', input: ['text' as const], reasoning: false }] }],
      codemode: { ...createDefaultPiwinConfig().codemode!, enabled, timeoutMs: 15_000, maxConcurrency: 1 },
    };
    const composed = await buildSessionHostTools({
      sessionId: SESSION, runtimeGenerationId: GENERATION, piwinRoot: root, projectPath: project,
      config, codemodePort: observedPort, mcpConfig: { mcpServers: {} },
    });
    // Keep the actual config-gated codemode registration, plus deterministic
    // read-only fixture executors. No real filesystem mutation/shell is exposed.
    const tools = [
      ...composed.filter((tool) => tool.descriptor.name === 'piwin_codemode'),
      readTool('fixture_rows', async (_args, _signal, context) => {
        contexts.push(context);
        const output = await readFile(datasetPath, 'utf8');
        return { ok: true, output, scriptPayload: { structuredContent: JSON.parse(output) } };
      }),
      readTool('fixture_error', async (_args, _signal, context) => {
        contexts.push(context);
        return { ok: true, output: 'fixture upstream failed',
          scriptPayload: { structuredContent: { hidden: FILLER }, isError: true } };
      }),
      readTool('fixture_failure', async (_args, _signal, context) => {
        contexts.push(context);
        return { ok: false, code: 'execution-failed', message: 'fixture read failed' };
      }),
      readTool('fixture_wait', async (_args, signal, context) => {
        contexts.push(context);
        resolveStarted();
        return new Promise((resolve) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            resolveAborted();
            resolve({ ok: false, code: 'aborted', message: 'fixture read aborted', cancelled: true });
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
      }),
    ];
    const compiled = await compileBlueprintForWorker({ projectPath: project, model: MODEL }, {
      piwinRoot: root, sessionId: SESSION, runtimeGenerationId: GENERATION, config,
      hostToolDescriptors: descriptorsFromTools(tools), hostToolFamilyIndex: toolFamilyIndex(tools),
      mcpConfig: { mcpServers: {} },
      discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      allowInlineProviderSecrets: mode === 'sdk', allowWorkerProviderSecretBootstrap: mode === 'rpc',
      secretResolver: { resolveProviderSecret: async () => 'fixture-key-not-a-secret' },
    });
    port.registerActiveGeneration(SESSION, GENERATION, tools, createPermissiveToolAdmission());
    const manifest = compiled.backendBlueprint.capabilitySnapshot.tools;
    port.restrictGeneration(SESSION, GENERATION, manifest.hostTools.map((tool) => tool.name),
      compiled.sessionBlueprint.hostToolboxTargetNames, manifest.enabledFamilies.includes('mcp'));
    backend = mode === 'sdk'
      ? new InProcessSdkSessionBackend({ agentDir })
      : new WorkerSessionBackend({ supervisor, worker: {
        env: { HOME: root, [PIWIN_PI_AGENT_DIR_ENV]: agentDir },
      } });
    const handle = await backend.createSession({
      blueprint: compiled.backendBlueprint, providers: compiled.providers,
      ...(compiled.providerSecrets ? { providerSecrets: compiled.providerSecrets } : {}),
      hostToolExecution: observedPort,
    });
    const events: AgentEvent[] = [];
    handle.subscribe((event) => events.push(event));
    return { handle, compiled, port, inputs, results, contexts, events, model, supervisor,
      started, aborted, serialized, close };
  } catch (error) {
    await close();
    throw error;
  }
}
