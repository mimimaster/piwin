import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { COMMON, TASKS, CHAIN_ORACLE, makeRows, aggregateRows, inventory, fingerprint, walkFiles, grade } from './tasks.mjs';
import { openProviderObserver, sumObservedUsage } from './provider-observer.mjs';

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(repository, 'apps/cli/package.json'));
const { HostRuntime, createDefaultPiwinConfig } = await import(require.resolve('@piwin/host-runtime'));
const { BUILTIN_ULTRA_CODE_SCHEME } = await import(require.resolve('@piwin/contracts'));
const output = join(repository, 'docs/research/scout-codemode-2026-10-11');
const sourceRoot = process.env.PIWIN_EXPERIMENT_SOURCE_ROOT ?? join(homedir(), '.piwin');
const modelId = process.env.PIWIN_EXPERIMENT_MODEL ?? 'grok-4.5';
const scoutModelId = process.env.PIWIN_EXPERIMENT_SCOUT_MODEL ?? 'grok-4.5';
const timeoutMs = 300_000;
const snapshotCommit = '5868a0de4af5afd3137d00b8142c6fc033d6d895';
const mainModel = { protocol: 'openai-compatible', source: 'channel', providerId: 'experiment-channel', modelId };
const scoutModel = { ...mainModel, modelId: scoutModelId };
const hash = value => createHash('sha256').update(value).digest('hex');
const assertSuccess = response => { if (!response.success) throw new Error(response.error ?? 'Host command failed'); return response.data; };

async function readProvider() {
  const config = JSON.parse(await readFile(join(sourceRoot, 'config.json'), 'utf8'));
  const provider = config.providers.find(candidate => candidate.id === 'custom-openai');
  if (!provider) throw new Error('configured custom-openai provider unavailable');
  let secret;
  if (provider.apiKeyEnv) secret = process.env[provider.apiKeyEnv];
  else if (provider.apiKeyRef?.startsWith('keychain:')) secret = (await exec('security', ['find-generic-password', '-w', '-s', provider.apiKeyRef.slice(9)])).stdout.trim();
  else if (provider.apiKeyRef) secret = (await readFile(resolve(sourceRoot, provider.apiKeyRef.replace(/^file:/, '')), 'utf8')).trim();
  if (!secret) throw new Error('configured provider credential unavailable');
  return { provider, secret };
}

function buildConfig(provider, baseUrl, enabled) {
  const config = createDefaultPiwinConfig();
  config.providers = [{ id: mainModel.providerId, label: 'Isolated real channel', protocol: 'openai-compatible',
    baseUrl, apiKeyEnv: 'PIWIN_EXPERIMENT_PROVIDER_KEY',
    models: [...new Set([modelId, scoutModelId])].map(id => {
      const original = provider.models?.find(model => model.id === id);
      if (!original) throw new Error(`model not configured: ${id}`);
      return { ...original, enabled: true, capabilities: ['chat'], nativeSearchAdapter: undefined, maxOutputTokens: 16000 };
    }) }];
  config.defaultProviderId = mainModel.providerId; config.defaultModelId = modelId;
  config.codemode.enabled = enabled;
  config.skills.enabled = false; config.extensions.enabled = false; config.prompts.enabled = false;
  config.artifact.enabled = false; config.web.searchEnabled = false;
  config.walkthrough.enabled = false; config.walkthrough.autoGenerate = false;
  config.permissions = { mode: 'bypass', preset: 'yolo' };
  const scheme = structuredClone(BUILTIN_ULTRA_CODE_SCHEME);
  if (!scheme) throw new Error('built-in Scout scheme unavailable');
  scheme.members = scheme.members.map(member => member.role === 'scout'
    ? { ...member, model: scoutModel, thinkingLevel: 'low', fallback: 'none' } : member);
  config.subagents.schemes = [scheme]; config.subagents.maxConcurrency = 2; config.subagents.maxTasksPerRun = 3;
  return config;
}

async function readLedger(root) {
  try { return (await readFile(join(root, 'usage/ledger.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function runTask({ project, provider, observer, task, group, repetition, ordinal, expected, snapshotHash }) {
  const root = await mkdtemp(join(tmpdir(), 'piwin-ab-host-'));
  const beforeRequests = observer.requests.length;
  const config = buildConfig(provider, observer.baseUrl, group === 'B');
  await writeFile(join(root, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(root, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  await writeFile(join(root, 'permissions.json'), JSON.stringify({ version: 1, deny: [
    { target: { kind: 'file-write', pathGlob: '**' }, decision: 'deny', reason: 'experiment-readonly' },
    { target: { kind: 'bash', pattern: 're:\\b(rm|mv|cp|mkdir|touch|chmod|chown|sudo|curl|wget)\\b' }, decision: 'deny', reason: 'experiment-readonly' },
    { target: { kind: 'bash', pattern: 're:\\bgit\\s+(add|commit|reset|checkout|switch|clean|stash|push)' }, decision: 'deny', reason: 'experiment-readonly' },
    { target: { kind: 'notes-mutate' }, decision: 'deny', reason: 'experiment-readonly' },
  ] }));
  await mkdir(join(root, 'pi-agent'));
  await writeFile(join(root, 'pi-agent/settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot: root, permissionModeOverride: 'bypass' });
  const events = []; const terminals = []; const messages = new Map(); const diagnostics = [];
  const unsubscribe = runtime.attachPushSink({ id: 'experiment-recorder', push(push) {
    if (push.type === 'event') {
      const event = push.event;
      if (['tool/start', 'tool/end', 'model/retry', 'usage/finalized', 'error', 'permission/request'].includes(event.type)) events.push({ sessionId: push.sessionId, event });
      if (event.type === 'message/start' && event.role === 'assistant') messages.set(`${push.sessionId}:${event.messageId}`, { sessionId: push.sessionId, text: '' });
      if (event.type === 'message/text_delta' || event.type === 'message/text_snapshot') {
        const value = messages.get(`${push.sessionId}:${event.messageId}`);
        if (value) value.text = event.type === 'message/text_snapshot' ? event.text : value.text + event.delta;
      }
      // Requests for side-effect actions are denied. Bash reads normally run under
      // the unchanged Host classifier; no weakening of Scout/read capabilities.
      if (event.type === 'permission/request') void runtime.handleCommand({ type: 'permission/respond', sessionId: push.sessionId, requestId: event.requestId, decision: 'deny' });
    }
    if (push.type === 'run/terminal') terminals.push(push.run);
    if (push.type === 'host/log' && push.level !== 'debug') diagnostics.push({ level: push.level, message: push.message });
  } });
  let sessionId; let runId; let status = 'setup-failed'; let failure = null; let elapsedMs = null;
  console.log(`START ${ordinal}/18 ${task.id} ${group}${repetition}`);
  try {
    assertSuccess(await runtime.handleCommand({ type: 'host/ping' }));
    assertSuccess(await runtime.handleCommand({ type: 'project/open', path: project }));
    assertSuccess(await runtime.handleCommand({ type: 'project/trust', path: project }));
    sessionId = assertSuccess(await runtime.handleCommand({ type: 'session/create', input: {
      scope: { kind: 'project', projectPath: project }, sessionName: `${task.id}-${group}${repetition}`,
      model: mainModel, thinkingLevel: 'high',
    } })).sessionId;
    const started = performance.now();
    runId = assertSuccess(await runtime.handleCommand({ type: 'session/prompt', sessionId, input: {
      text: `${COMMON}\n\n${task.prompt}`, orchestrationSchemeId: 'ultra-code',
    } })).runId;
    while (!terminals.some(run => run.runId === runId) && performance.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    elapsedMs = Math.round(performance.now() - started);
    const terminal = terminals.find(run => run.runId === runId);
    status = terminal?.status ?? 'timeout';
    if (!terminal) { await runtime.handleCommand({ type: 'session/abort', sessionId }); failure = '300000ms hard deadline'; }
    if (terminal?.error) failure = terminal.error;
  } catch (error) { failure = error.message; }
  finally { unsubscribe(); await runtime.dispose(); }
  const answer = [...messages.values()].filter(message => message.sessionId === sessionId && message.text.trim()).at(-1)?.text ?? '';
  const ledger = await readLedger(root);
  const requests = observer.requests.slice(beforeRequests);
  const scoutIds = [...new Set(events.filter(row => row.sessionId !== sessionId).map(row => row.sessionId))];
  const tools = events.filter(row => row.event.type === 'tool/start');
  const codemodeIds = new Set(tools.filter(row => row.event.toolName === 'piwin_codemode').map(row => row.event.toolCallId));
  const codemodeEnds = events.filter(row => row.event.type === 'tool/end' && codemodeIds.has(row.event.toolCallId));
  const nestedCalls = [];
  // Codemode native-context details remain in the persisted transcript. Read
  // them only for measurement; never inject them into an experimental session.
  let transcriptFiles = [];
  try { transcriptFiles = await walkFiles(join(root, 'sessions')); }
  catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ level: 'warn', message: 'Transcript observation unavailable: ' + error.message }); }
  for (const path of transcriptFiles) {
    if (!path.endsWith('.jsonl')) continue;
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.type === 'tool' && row.toolName === 'piwin_codemode' && row.details?.calls) nestedCalls.push(...row.details.calls);
      } catch { /* Transcript may contain non-record files; no metrics are inferred. */ }
    }
  }
  const validation = grade(task.id, answer, expected);
  const unchanged = await fingerprint(project) === snapshotHash;
  const result = {
    ordinal, taskId: task.id, group, repetition, sessionId, runId, status, failure, elapsedMs,
    configHashWithoutCodemodeEnabled: hash(JSON.stringify({ ...config, codemode: { ...config.codemode, enabled: null } })),
    promptHash: hash(`${COMMON}\n\n${task.prompt}`), snapshotHash, sourceUnchanged: unchanged,
    validation, answer, scoutSessionIds: scoutIds, scoutCount: scoutIds.length,
    toolCalls: tools.length, mainToolCalls: tools.filter(row => row.sessionId === sessionId).length,
    scoutToolCalls: tools.filter(row => row.sessionId !== sessionId).length,
    codemodeCalls: tools.filter(row => row.event.toolName === 'piwin_codemode').length,
    codemodeFailures: codemodeEnds.filter(row => row.event.isError).length,
    nestedCalls, nestedCallCount: nestedCalls.length || (tools.some(row => row.event.toolName === 'piwin_codemode') ? null : 0),
    toolFailures: events.filter(row => row.event.type === 'tool/end' && row.event.isError).length,
    modelRetryAttempts: events.filter(row => row.event.type === 'model/retry' && row.event.phase === 'attempting').length,
    toolRetryAttempts: null, upstreamInternalRetries: null,
    observedUsage: sumObservedUsage(requests), providerRequests: requests, usageLedger: ledger, events, diagnostics,
  };
  await writeFile(join(output, `${String(ordinal).padStart(2, '0')}-${task.id}-${group}${repetition}.json`), JSON.stringify(result, null, 2).replaceAll(process.env.PIWIN_EXPERIMENT_PROVIDER_KEY, '[REDACTED]'));
  if (!process.env.PIWIN_EXPERIMENT_KEEP_STATE) await rm(root, { recursive: true, force: true });
  console.log(`END ${ordinal}/18 ${status} correct=${validation.passed} scout=${scoutIds.length} codemode=${result.codemodeCalls} tokens=${result.observedUsage?.totalTokens ?? 'unknown'} ms=${elapsedMs}`);
  return result;
}

async function main() {
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).some(name => /^\d{2}-.*\.json$/.test(name))) {
    throw new Error('Raw attempts already exist. Preserve this experiment and use a fresh worktree/output directory for a separately authorized experiment.');
  }
  const { provider, secret } = await readProvider();
  const observer = await openProviderObserver(provider.baseUrl, secret);
  process.env.PIWIN_EXPERIMENT_PROVIDER_KEY = secret;
  process.env.PIWIN_MOCK = '0';
  const project = await mkdtemp(join(tmpdir(), 'piwin-ab-snapshot-'));
  try {
    const commit = (await exec('git', ['rev-parse', snapshotCommit], { cwd: repository })).stdout.trim();
    const archive = join(project, 'snapshot.tar');
    await exec('git', ['archive', '--format=tar', '-o', archive, commit], { cwd: repository });
    await exec('tar', ['-xf', archive, '-C', project]); await rm(archive);
    await mkdir(join(project, 'experiment-data'));
    const rows = makeRows();
    const fixture = JSON.stringify({ schemaVersion: 1, rows });
    await writeFile(join(project, 'experiment-data/orders.json'), fixture);
    const expected = { 'call-chain': CHAIN_ORACLE, 'cross-file': await inventory(project), 'structured-data': aggregateRows(rows) };
    const snapshotHash = await fingerprint(project);
    for (const path of await walkFiles(project)) await chmod(path, 0o444);
    const manifest = { commit, backend: 'sdk', mainModel, mainThinking: 'high', scoutModel, scoutThinking: 'low',
      sourceRoot, upstreamBaseUrl: provider.baseUrl, snapshotHash, fixtureHash: hash(fixture), fixtureBytes: Buffer.byteLength(fixture),
      timeoutMs, scheme: 'ultra-code', commonPrompt: COMMON, tasks: TASKS, expected, startedAt: new Date().toISOString(),
      measurement: 'Host finalized usage ledger + transparent real-provider SSE usage observer',
      sequence: TASKS.flatMap((task, index) => Array.from({ length: 3 }, (_, repetition) => (index % 2 === 0 ? ['A','B'] : ['B','A']).map(group => ({ taskId: task.id, group, repetition: repetition + 1 }))).flat()) };
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (process.argv.includes('--prepare-only')) {
      buildConfig(provider, observer.baseUrl, false); buildConfig(provider, observer.baseUrl, true);
      return;
    }
    let ordinal = 0;
    for (const scheduled of manifest.sequence) {
      ordinal += 1;
      const task = TASKS.find(task => task.id === scheduled.taskId);
      await runTask({ project, provider, observer, task, ...scheduled, ordinal, expected: expected[task.id], snapshotHash });
    }
  } finally { await observer.close(); delete process.env.PIWIN_EXPERIMENT_PROVIDER_KEY; await rm(project, { recursive: true, force: true }); }
}
await main();
