/** Test-only local scripted OpenAI wire. Pi SDK/worker and Host tools are NOT mocked. */
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AgentWorkerSupervisor, InProcessSdkSessionBackend, WorkerSessionBackend,
  type BackendSessionHandle, type PiSessionBackend,
} from '@piwin/agent-host';
import type { BackendSessionBlueprint, FlashcardStudySnapshot, ExtensionUiRequest } from '@piwin/contracts';
import { createStudyServices, resetStudyCoordinatorsForTests } from '@piwin/flashcards';
import { buildFlashcardTools } from './flashcard-tools.js';
import { buildFlashcardStudyTools } from './flashcard-study-tools.js';
import { buildHostToolboxRegistration } from './tool-catalog/catalog-tool.js';
import { createSessionHostToolExecutionPort } from './tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from './tools/tool-admission.js';

type Step = { name: string; args: Record<string, unknown> } | { text: string };
export type SavedCourse = {
  courseId: string; deck: string; revision: number;
  evidence: Array<{ id: string; userAnswer: string }>;
  intentions: Array<{ attempts: Array<{ state: string; cardIds: string[] }> }>;
};
export async function openStudySpaceFixture(mode: 'sdk' | 'rpc') {
  const root = await mkdtemp(join(tmpdir(), 'study-space-real-'));
  const oldRoot = process.env.PIWIN_ROOT;
  const oldKey = process.env.STUDY_SPACE_TEST_KEY;
  process.env.PIWIN_ROOT = root; process.env.STUDY_SPACE_TEST_KEY = 'local-fixture-only';
  const requests: Record<string, unknown>[] = [];
  const dialogs: ExtensionUiRequest[] = [];
  const steps: Step[] = [];
  let callNumber = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      const step = steps.shift() ?? { text: 'Done.' };
      const delta = 'name' in step
        ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${++callNumber}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] }
        : { role: 'assistant', content: step.text };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (part: unknown, finish: string | null) => JSON.stringify({ id: `completion_${callNumber}`, object: 'chat.completion.chunk', created: 1, model: 'study-fixture', choices: [{ index: 0, delta: part, finish_reason: finish }] });
      response.write(`data: ${chunk(delta, null)}\n\n`);
      response.end(`data: ${chunk({}, 'name' in step ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
    })().catch(error => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    });
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  const services = createStudyServices({ piwinRoot: root });
  const targets = [...buildFlashcardTools({ store: services.cardStore, enabled: true }), ...buildFlashcardStudyTools({ getStudyService: async () => services.study })];
  const toolbox = buildHostToolboxRegistration(targets);
  const tools = [...targets, toolbox];
  let generation = 'gen-1';
  let activeRun = '';
  let lastSnapshot: FlashcardStudySnapshot | undefined;
  const port = createSessionHostToolExecutionPort({ isSessionKnown: id => id === 'study-session', getRuntimeGenerationId: () => generation, isRunAdmitted: run => run === activeRun });
  function register() {
    port.registerActiveGeneration('study-session', generation, tools, createPermissiveToolAdmission());
    port.restrictGeneration('study-session', generation, ['piwin_toolbox'], targets.map(tool => tool.descriptor.name));
  }
  register();
  const input = (): Parameters<PiSessionBackend['createSession']>[0] => {
    const blueprint: BackendSessionBlueprint = {
      version: 1, sessionId: 'study-session', runtimeGenerationId: generation,
      model: { providerId: 'study-local', modelId: 'study-fixture', protocol: 'openai-compatible' },
      capabilitySnapshot: {
        version: 1, snapshotId: `snapshot-${generation}`, inputs: { rulesRevision: 'r', settingsRevision: 'r', projectRevision: 'r', mcpRevision: 'r', resourceCatalogRevision: 'r' },
        scope: { kind: 'general' }, workingDirectory: root, trust: { kind: 'general' },
        resources: {
          skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
        },
        resourceManifest: { skills: [], prompts: [], diagnostics: [], extensions: [{ resourceId: 'study-space', kind: 'extension', name: 'study-space', source: 'user', path: resolve('../agent-host/standalone-extensions/study-space/index.ts') }] },
        context: { allowPiNativeInstructions: false, allowProjectAgentsFiles: false, allowProjectSystemPrompts: false },
        contextManifest: { agentsFiles: [] },
        tools: { hostTools: [toolbox.descriptor], piBuiltinToolNames: [], enabledFamilies: ['toolbox', 'flashcards-read', 'flashcards-write'], enabledMcpServerIds: [] },
      },
    };
    return {
      blueprint,
      providers: [{ providerId: 'study-local', protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${address.port}/v1`, auth: { kind: 'env', envName: 'STUDY_SPACE_TEST_KEY' }, models: [{ id: 'study-fixture', input: ['text'], reasoning: false, contextWindow: 128000, maxOutputTokens: 8192 }] }],
      hostToolExecution: { execute: async (invocation, signal) => {
        const result = await port.execute(invocation, signal);
        if (result.ok && result.output && invocation.arguments.target === 'flashcard_study_write') {
          lastSnapshot = JSON.parse(result.output) as FlashcardStudySnapshot;
        }
        return result;
      } },
      extensionUi: { request: async request => {
        dialogs.push(request);
        if (request.kind === 'confirm') return { kind: 'confirm', confirmed: true };
        throw new Error(`Unexpected test dialog ${request.kind}`);
      } },
    };
  };
  const backend = mode === 'sdk'
    ? new InProcessSdkSessionBackend({ agentDir: join(root, 'pi-agent') })
    : new WorkerSessionBackend({ supervisor: new AgentWorkerSupervisor(), disposeSupervisor: true, worker: { nodeArgs: ['--import', 'tsx'], env: { PIWIN_ROOT: root, PIWIN_PI_AGENT_DIR: join(root, 'pi-agent') } } });
  async function close() {
    try { await backend.dispose(); }
    finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
      if (oldRoot === undefined) delete process.env.PIWIN_ROOT; else process.env.PIWIN_ROOT = oldRoot;
      if (oldKey === undefined) delete process.env.STUDY_SPACE_TEST_KEY; else process.env.STUDY_SPACE_TEST_KEY = oldKey;
      resetStudyCoordinatorsForTests(); await rm(root, { recursive: true, force: true });
    }
  }
  let session: BackendSessionHandle;
  try { session = await backend.createSession(input()); }
  catch (error) { await close(); throw error; }
  let runCount = 0;
  async function prompt(text: string) {
    activeRun = `run-${++runCount}`;
    try {
      const model = input().blueprint.model;
      return await session.prompt({
        // Mirrors Host preparation: the native command must not receive context
        // blocks as its arguments, but unknown slash text still receives rules.
        text: `Host instructions and history.\n\n${text}\n\n<theme>dark</theme>`,
        ...(text.startsWith('/') ? { extensionCommandText: text } : {}),
        runId: activeRun, ...(model ? { model } : {}),
      });
    }
    finally { activeRun = ''; }
  }
  async function tool(name: string, args: Record<string, unknown>, text = 'Continue the current exercise.') {
    steps.push({ name, args });
    const outcome = await prompt(text);
    if (steps.length) throw new Error(`Scripted tool ${name} was not requested by Pi`);
    return outcome;
  }
  return {
    root, requests, dialogs, services, prompt, tool,
    native: (target: string, args: Record<string, unknown>) => tool('piwin_toolbox', { action: 'call', target, arguments: args }),
    snapshot() { if (!lastSnapshot) throw new Error('No native snapshot'); return lastSnapshot; },
    async course(): Promise<SavedCourse> {
      const names = (await readdir(join(root, 'study-space'))).filter(name => name.endsWith('.json') && name !== 'preferences.json');
      if (names.length !== 1 || !names[0]) throw new Error('Expected one saved course');
      return JSON.parse(await readFile(join(root, 'study-space', names[0]), 'utf8')) as SavedCourse;
    },
    async replace() { await backend.dropSession('study-session'); generation = 'gen-2'; register(); session = await backend.createSession(input()); },
    close,
  };
}
