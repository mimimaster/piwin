import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { COMMON, TASKS, CHAIN_ORACLE, makeRows, aggregateRows, inventory, fingerprint, walkFiles, grade } from './tasks.mjs';
import { installModelApiOnlyFetch, networkDenials } from './network-isolation.mjs';
import { decideExperimentPermission } from './experiment-permissions.mjs';
import { prepareOolong, gradeOolong } from './oolong-tasks.mjs';
import { readNativeSessions, sumLedger } from './native-sessions.mjs';
import { openProviderObserver, sumObservedUsage } from './provider-observer.mjs';

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(repository, 'apps/cli/package.json'));
if (process.argv.includes('--oolong')) installModelApiOnlyFetch();
const { HostRuntime, createDefaultPiwinConfig } = await import(require.resolve('@piwin/host-runtime'));
const { BUILTIN_ULTRA_CODE_SCHEME } = await import(require.resolve('@piwin/contracts'));
const oauth = process.argv.includes('--oauth');
const oolong = process.argv.includes('--oolong');
const resumeOolong = process.argv.includes('--resume-oolong');
if (resumeOolong && !oolong) throw new Error('Resume is restricted to the counted OOLONG interruption');
if (oolong && !oauth) throw new Error('OOLONG experiment requires the authorized OAuth channel');
const output = process.env.PIWIN_EXPERIMENT_OUTPUT_DIR ?? join(repository, 'docs/research', oolong ? 'scout-codemode-oolong-2026-10-11' : (oauth ? 'scout-codemode-oauth-2026-10-11' : 'scout-codemode-2026-10-11'));
const sourceRoot = process.env.PIWIN_EXPERIMENT_SOURCE_ROOT ?? join(homedir(), oauth ? '.piwin-test' : '.piwin');
const modelId = process.env.PIWIN_EXPERIMENT_MODEL ?? 'grok-4.5';
const scoutModelId = process.env.PIWIN_EXPERIMENT_SCOUT_MODEL ?? 'grok-4.5';
const timeoutMs = oolong ? 900_000 : 300_000;
const snapshotCommit = '5868a0de4af5afd3137d00b8142c6fc033d6d895';
const mainModel = { protocol: 'openai-compatible', source: oauth ? 'subscription' : 'channel', providerId: oauth ? 'xai' : 'experiment-channel', modelId };
const scoutModel = { ...mainModel, modelId: scoutModelId };
const hash = value => createHash('sha256').update(value).digest('hex');
const assertSuccess = response => { if (!response.success) throw new Error(response.error ?? 'Host command failed'); return response.data; };

async function readProvider() {
  const config = JSON.parse(await readFile(join(sourceRoot, 'config.json'), 'utf8'));
  const provider = config.providers.find(candidate => candidate.id === (oauth ? 'xai' : 'custom-openai'));
  if (oauth) {
    const authPath = join(sourceRoot, 'pi-agent/auth.json');
    const original = await readFile(authPath, 'utf8');
    const credential = JSON.parse(original).xai;
    if (!credential?.access || credential.expires - Date.now() < 30 * 60_000) throw new Error('OAuth access token is missing or near expiry; source credentials will not be refreshed by this experiment');
    return { provider, credential, authPath, authHash: hash(original) };
  }
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
  config.providers = oauth ? [{ ...provider, models: provider.models.filter(model => [modelId, scoutModelId].includes(model.id)).map(model => ({ ...model, enabled: true, capabilities: ['chat'] })) }] : [{ id: mainModel.providerId, label: 'Isolated real channel', protocol: 'openai-compatible',
    baseUrl, apiKeyEnv: 'PIWIN_EXPERIMENT_PROVIDER_KEY',
    models: [...new Set([modelId, scoutModelId])].map(id => {
      const original = provider.models?.find(model => model.id === id);
      if (!original) throw new Error(`model not configured: ${id}`);
      return { ...original, enabled: true, capabilities: ['chat'], nativeSearchAdapter: undefined, maxOutputTokens: 16000 };
    }) }];
  config.defaultProviderId = mainModel.providerId; config.defaultModelId = modelId;
  config.codemode.enabled = enabled;
  config.skills.enabled = false; config.extensions.enabled = false; config.prompts.enabled = false;
  config.artifact.enabled = false;
  config.web.searchProvider = 'none'; config.web.searchSources = [];
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

async function runTask({ project, provider, observer, task, group, repetition, ordinal, expected, snapshotHash, credential, redact }) {
  const root = await mkdtemp(join(tmpdir(), 'piwin-ab-host-'));
  const beforeNetworkDenials = networkDenials.length;
  const beforeRequests = observer.requests?.length ?? 0;
  if (oauth) {
    process.env.PIWIN_EXPERIMENT_OBSERVER_RUN_DIR = join(observer.directory, String(ordinal));
    process.env.PIWIN_ROOT = root; process.env.PIWIN_PI_AGENT_DIR = join(root, 'pi-agent');
  }
  const config = buildConfig(provider, observer.baseUrl, group === 'B');
  await writeFile(join(root, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(root, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  await writeFile(join(root, 'permissions.json'), JSON.stringify({ version: 1, deny: [
    { target: { kind: 'file-write', pathGlob: '**' }, decision: 'deny', reason: 'experiment-readonly' },
    { target: { kind: 'bash', pattern: 're:\\b(rm|mv|cp|mkdir|touch|chmod|chown|sudo|curl|wget)\\b' }, decision: 'deny', reason: 'experiment-readonly' },
    { target: { kind: 'bash', pattern: 're:\\bgit\\s+(add|commit|reset|checkout|switch|clean|stash|push)' }, decision: 'deny', reason: 'experiment-readonly' },
    ...(oolong ? [
      { target: { kind: 'web-search' }, decision: 'deny', reason: 'experiment-no-network' },
      { target: { kind: 'process' }, decision: 'deny', reason: 'experiment-readonly' },
      { target: { kind: 'git', pattern: '*' }, decision: 'deny', reason: 'experiment-readonly' },
    ] : []),
    { target: { kind: 'notes-mutate' }, decision: 'deny', reason: 'experiment-readonly' },
  ], allow: oolong ? [{ target: { kind: 'bash', pattern: '*' }, decision: 'allow', reason: 'experiment-os-protected-shell' }] : [] }));
  await mkdir(join(root, 'pi-agent'));
  if (oauth) await writeFile(join(root, 'pi-agent/auth.json'), JSON.stringify({ xai: credential }), { mode: 0o600 });
  await writeFile(join(root, 'pi-agent/settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot: root, permissionModeOverride: 'bypass' });
  const events = []; const terminals = []; const messages = new Map(); const diagnostics = [];
  const unsubscribe = runtime.attachPushSink({ id: 'experiment-recorder', push(push) {
    if (push.type === 'event' || push.type === 'subagent/stream') {
      const recordedSessionId = push.type === 'event' ? push.sessionId : push.childSessionId;
      const event = push.event;
      if (['tool/start', 'tool/end', 'model/retry', 'usage/finalized', 'error', 'permission/request'].includes(event.type)) events.push({ sessionId: recordedSessionId, event });
      if (event.type === 'message/start' && event.role === 'assistant') messages.set(`${recordedSessionId}:${event.messageId}`, { sessionId: recordedSessionId, text: '' });
      if (event.type === 'message/text_delta' || event.type === 'message/text_snapshot') {
        const value = messages.get(`${recordedSessionId}:${event.messageId}`);
        if (value) value.text = event.type === 'message/text_snapshot' ? event.text : value.text + event.delta;
      }
      // Requests for side-effect actions are denied. Bash reads normally run under
      // the unchanged Host classifier; no weakening of Scout/read capabilities.
      if (event.type === 'permission/request') void runtime.handleCommand({ type: 'permission/respond', sessionId: recordedSessionId, requestId: event.requestId, decision: 'deny' });
    }
    if (push.type === 'permission/request') {
      events.push({ sessionId: push.sessionId, event: { ...push } });
      void runtime.handleCommand({ type: 'permission/respond', sessionId: push.sessionId, requestId: push.requestId, decision: oolong ? decideExperimentPermission(push.action) : 'deny' }).then(response => { if (!response.success) diagnostics.push({ level: 'error', message: response.error ?? 'permission response failed' }); });
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
    if (!terminal) { await runtime.handleCommand({ type: 'session/abort', sessionId }); failure = `${timeoutMs}ms hard deadline`; }
    if (terminal?.error) failure = terminal.error;
  } catch (error) { failure = error.message; }
  finally { unsubscribe(); await runtime.dispose(); }
  const answer = [...messages.values()].filter(message => message.sessionId === sessionId && message.text.trim()).at(-1)?.text ?? '';
  const ledger = await readLedger(root);
  const nativeSessions = oauth ? await readNativeSessions(root) : null;
  const requests = oauth ? await observer.readRequests(ordinal) : observer.requests.slice(beforeRequests);
  const usageRequests = requests.filter(request => request.failure !== 'ExperimentNetworkDenied');
  const scoutIds = [...new Set(events.filter(row => row.sessionId !== sessionId).map(row => row.sessionId))];
  const tools = events.filter(row => row.event.type === 'tool/start');
  const codemodeIds = new Set(tools.filter(row => row.event.toolName === 'piwin_codemode').map(row => row.event.toolCallId));
  const codemodeEnds = events.filter(row => row.event.type === 'tool/end' && codemodeIds.has(row.event.toolCallId));
  const codemodeResults = nativeSessions?.sessions.flatMap(session => session.records.filter(record => record.toolName === 'piwin_codemode')) ?? [];
  const nestedCalls = codemodeResults.flatMap(record => record.details?.calls ?? []);
  const nestedComplete = codemodeResults.length > 0 && codemodeResults.every(record => record.details?.invocationLocalStore === true);
  const validation = oolong ? gradeOolong(answer, expected) : grade(task.id, answer, expected);
  const unchanged = await fingerprint(project) === snapshotHash;
  const result = {
    ordinal, taskId: task.id, group, repetition, sessionId, runId, status, failure, elapsedMs,
    configHashWithoutCodemodeEnabled: hash(JSON.stringify({ ...config, codemode: { ...config.codemode, enabled: null } })),
    promptHash: hash(`${COMMON}\n\n${task.prompt}`), snapshotHash, sourceUnchanged: unchanged,
    validation, answer, networkDenials: networkDenials.slice(beforeNetworkDenials), nativeSessions, scoutSessionIds: scoutIds, scoutCount: scoutIds.length,
    toolCalls: tools.length, mainToolCalls: tools.filter(row => row.sessionId === sessionId).length,
    scoutToolCalls: tools.filter(row => row.sessionId !== sessionId).length,
    codemodeCalls: tools.filter(row => row.event.toolName === 'piwin_codemode').length,
    codemodeFailures: codemodeEnds.filter(row => row.event.isError).length,
    nestedCalls, nestedCallCount: nestedComplete ? nestedCalls.length : (codemodeIds.size ? null : 0),
    toolFailures: events.filter(row => row.event.type === 'tool/end' && row.event.isError).length,
    modelRetryAttempts: events.filter(row => row.event.type === 'model/retry' && row.event.phase === 'attempting').length,
    toolRetryAttempts: null, upstreamInternalRetries: null,
    observedUsage: oauth ? null : sumObservedUsage(usageRequests),
    observedMainSseUsage: oauth ? sumObservedUsage(usageRequests) : null,
    mainLedgerUsage: sumLedger(ledger.filter(record => record.sessionId === sessionId)),
    scoutLedgerUsage: sumLedger(ledger.filter(record => scoutIds.includes(record.sessionId))),
    mainObservedUsage: sumObservedUsage(usageRequests.filter(request => request.reasoningEffort === 'high')),
    scoutObservedUsage: sumObservedUsage(usageRequests.filter(request => request.reasoningEffort === 'low')), providerRequests: requests, usageLedger: ledger, events, diagnostics,
  };
  await writeFile(join(output, `${String(ordinal).padStart(2, '0')}-${task.id}-${group}${repetition}.json`), redact(JSON.stringify(result, null, 2)));
  if (!process.env.PIWIN_EXPERIMENT_KEEP_STATE) await rm(root, { recursive: true, force: true });
  console.log(`END ${ordinal}/18 ${status} correct=${validation.passed} scout=${scoutIds.length} codemode=${result.codemodeCalls} mainTokens=${result.mainObservedUsage?.totalTokens ?? 'unknown'} ms=${elapsedMs}`);
  return result;
}

async function main() {
  await mkdir(output, { recursive: true });
  const existing = (await readdir(output)).filter(name => /^\d{2}-.*\.json$/.test(name));
  let interruption; let priorManifest;
  if (resumeOolong) {
    interruption = JSON.parse(await readFile(join(output, 'interrupted-attempt.json'), 'utf8'));
    if (![1, 4, 5, 6].includes(interruption.ordinal) || existing.length !== interruption.ordinal) throw new Error('Resume only permits the recorded counted interruption; no reruns');
    const ordered = existing.sort();
    if (ordered.some((name, index) => Number(name.slice(0, 2)) !== index + 1)) throw new Error('Interrupted schedule has gaps');
    const last = JSON.parse(await readFile(join(output, ordered.at(-1)), 'utf8'));
    if (!last.status.startsWith('invalid-')) throw new Error('Last attempt is not the recorded protocol interruption');
    priorManifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  } else if (existing.length) {
    throw new Error('Raw attempts already exist. Preserve this experiment and use a fresh worktree/output directory for a separately authorized experiment.');
  }
  const connection = await readProvider();
  const { provider, secret, credential } = connection;
  if (resumeOolong) {
    const original = JSON.parse(await readFile(join(interruption.oldHostRoot, 'pi-agent/auth.json'), 'utf8')).xai;
    if (hash(JSON.stringify(original)) !== hash(JSON.stringify(credential))) throw new Error('Pinned xAI credential changed; refusing resume');
  }
  const redact = value => [secret, credential?.access, credential?.refresh].filter(Boolean).reduce((text, item) => text.replaceAll(item, '[REDACTED]'), value);
  let observer;
  if (oauth) {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-oauth-observer-'));
    // Worker environments are intentionally filtered by Host. Their usage
    // comes from native Pi sessions; this fetch observer sees the main model.
    await import('./fetch-observer.mjs');
    observer = { directory, baseUrl: provider.baseUrl, async readRequests(ordinal) {
      const runDirectory = join(directory, String(ordinal));
      let names;
      try { names = await readdir(runDirectory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      return (await Promise.all(names.map(async name => JSON.parse(await readFile(join(runDirectory, name), 'utf8'))))).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    }, close: async () => rm(directory, { recursive: true, force: true }) };
  } else { observer = await openProviderObserver(provider.baseUrl, secret); process.env.PIWIN_EXPERIMENT_PROVIDER_KEY = secret; }
  process.env.PIWIN_MOCK = '0';
  if (oolong) process.env.SHELL = join(import.meta.dirname, 'readonly-shell.sh');
  const project = interruption?.projectPath ?? await mkdtemp(join(tmpdir(), 'piwin-ab-snapshot-'));
  let experimentStarted = false;
  try {
    const commit = (await exec('git', ['rev-parse', snapshotCommit], { cwd: repository })).stdout.trim();
    if (!resumeOolong) {
      const archive = join(project, 'snapshot.tar');
      await exec('git', ['archive', '--format=tar', '-o', archive, commit], { cwd: repository });
      await exec('tar', ['-xf', archive, '-C', project]); await rm(archive);
      await mkdir(join(project, 'experiment-data'));
    }
    const prepared = resumeOolong ? { tasks: priorManifest.tasks, expected: priorManifest.expected, provenance: priorManifest.benchmark } : (oolong ? await prepareOolong(project, output) : null);
    const tasks = prepared?.tasks ?? TASKS;
    const rows = oolong ? null : makeRows();
    const fixture = rows ? JSON.stringify({ schemaVersion: 1, rows }) : null;
    if (fixture) await writeFile(join(project, 'experiment-data/orders.json'), fixture);
    const expected = prepared?.expected ?? { 'call-chain': CHAIN_ORACLE, 'cross-file': await inventory(project), 'structured-data': aggregateRows(rows) };
    const snapshotHash = await fingerprint(project);
    if (resumeOolong && snapshotHash !== priorManifest.snapshotHash) throw new Error('Original fixed snapshot changed; refusing resume');
    if (!resumeOolong) for (const path of await walkFiles(project)) await chmod(path, 0o444);
    const manifest = { commit, backend: 'sdk', mainModel, mainThinking: 'high', scoutModel, scoutThinking: 'low',
      sourceRoot, upstreamBaseUrl: oauth ? 'https://api.x.ai/v1' : provider.baseUrl, credentialMode: oauth ? 'native xai OAuth' : 'channel', sourceAuthHash: priorManifest?.sourceAuthHash ?? connection.authHash ?? null, sourceAuthHashAtResume: resumeOolong ? connection.authHash : null, xaiCredentialHash: oauth ? hash(JSON.stringify(credential)) : null, snapshotHash, fixtureHash: fixture ? hash(fixture) : null, fixtureBytes: fixture ? Buffer.byteLength(fixture) : prepared.provenance.tasks.reduce((total, row) => total + row.inputBytes, 0),
      timeoutMs, scheme: 'ultra-code', commonPrompt: COMMON, tasks, expected, benchmark: prepared?.provenance ?? null, startedAt: priorManifest?.startedAt ?? new Date().toISOString(),
      resumedAt: resumeOolong ? new Date().toISOString() : null,
      readOnlyIsolation: oolong ? { shell: process.env.SHELL, profile: 'readonly-shell.sb', profileHash: hash(await readFile(join(import.meta.dirname, 'readonly-shell.sb'))), denies: ['file-write*', 'network*'], firstProtectedOrdinal: resumeOolong ? 2 : 1, invalidAttempt: interruption?.reason ?? null, networkToolsDeniedFromOrdinal: resumeOolong ? interruption.ordinal + 1 : 1, permissionMode: 'bypass', networkGuardHash: hash(await readFile(join(import.meta.dirname, 'network-isolation.mjs'))) } : null,
      measurement: 'Main Host usage ledger + passive main OAuth SSE metadata + native Pi SDK/RPC assistant usage',
      sequence: tasks.flatMap((task, index) => Array.from({ length: 3 }, (_, repetition) => (oauth || index % 2 === 0 ? ['A','B'] : ['B','A']).map(group => ({ taskId: task.id, group, repetition: repetition + 1 }))).flat()) };
    if (resumeOolong && (JSON.stringify(manifest.sequence) !== JSON.stringify(priorManifest.sequence) || JSON.stringify(mainModel) !== JSON.stringify(priorManifest.mainModel) )) throw new Error('Schedule, model or source credential changed; refusing resume');
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (resumeOolong) {
      await rm(interruption.oldHostRoot, { recursive: true, force: true });
      await rm(interruption.oldObserverRoot, { recursive: true, force: true });
    }
    experimentStarted = true;
    if (process.argv.includes('--prepare-only')) {
      buildConfig(provider, observer.baseUrl, false); buildConfig(provider, observer.baseUrl, true);
      return;
    }
    let ordinal = 0;
    for (const scheduled of manifest.sequence) {
      ordinal += 1;
      if (resumeOolong && ordinal <= interruption.ordinal) continue;
      const task = tasks.find(task => task.id === scheduled.taskId);
      const result = await runTask({ project, provider, observer, task, ...scheduled, ordinal, expected: expected[task.id], snapshotHash, credential, redact });
      if (oauth && result.status !== 'completed' && result.toolCalls === 0) {
        console.log('STOP: generation/admission failed before tools; preserving this counted attempt instead of repeating a systemic blocker.');
        break;
      }
    }
  } finally {
    if (oauth) {
      const afterHash = hash(await readFile(connection.authPath, 'utf8'));
      await writeFile(join(output, 'source-auth-integrity.json'), JSON.stringify({ before: connection.authHash, after: afterHash, unchanged: afterHash === connection.authHash }, null, 2));
    }
    await observer.close(); delete process.env.PIWIN_EXPERIMENT_PROVIDER_KEY; if (!resumeOolong || experimentStarted) await rm(project, { recursive: true, force: true }); }
}
await main();
