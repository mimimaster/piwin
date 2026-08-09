#!/usr/bin/env node
/**
 * Native SDK/RPC session-runtime residency soak (ADR 0040 / WP8).
 *
 * Run through tsx because @piwin workspace packages export TypeScript source:
 *   pnpm exec tsx scripts/session-runtime-rss-soak.mjs --mode sdk --duration-minutes 30
 *
 * The runner copies normalized config into a temporary PIWIN_ROOT, never logs
 * provider config/secrets, samples bounded aggregate resource IPC, and proves
 * observed RPC worker PIDs are gone after Host disposal.
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  HostRuntime,
  createSecretResolver,
  getPiwinRoot,
  loadPiwinConfig,
  savePiwinConfig,
} from '../packages/host-runtime/src/index.ts';

const CSV_COLUMNS = [
  'timestamp',
  'elapsedSeconds',
  'phase',
  'cycle',
  'hostRssMiB',
  'workerRssMiB',
  'aggregateRssMiB',
  'sampleCompleteness',
  'resident',
  'idle',
  'busy',
  'activating',
  'suspending',
  'waiters',
  'maxResident',
  'maxIdle',
  'highWaterMiB',
  'evictedIdleTtl',
  'evictedMaxIdle',
  'evictedMaxResident',
  'evictedMemory',
  'memoryPressureFailures',
  'descendantCount',
  'descendantRssMiB',
  'workerPids',
];

const execFileAsync = promisify(execFile);
const options = parseArguments(process.argv.slice(2));
const startedAt = new Date();
const evidenceBase = resolve(
  options.output ??
    `docs/evidence/session-runtime-rss-soak-${dateStamp(startedAt)}-${options.mode}`,
);
const csvPath = `${evidenceBase}.csv`;
const summaryPath = `${evidenceBase}.summary.json`;
await mkdir(dirname(evidenceBase), { recursive: true });
await writeFile(csvPath, `${CSV_COLUMNS.join(',')}\n`, 'utf8');

const sourceRoot = getPiwinRoot(options.sourcePiwinRoot);
const runRoot = await mkdtemp(`${tmpdir()}/piwin-runtime-soak-${options.mode}-`);
const projectPath = resolve(options.project ?? process.cwd());
const terminalWaiters = new Map();
const terminalRuns = new Map();
const observedWorkerPids = new Set();
const samples = [];
const failures = [];
const temporarySecretEnvNames = [];
let phase = 'setup';
let cycle = 0;
let sampling = true;
let runtime;
let samplerPromise;
let soakStartedAt;

try {
  const config = await loadPiwinConfig(sourceRoot);
  if (options.mode === 'rpc') {
    const secretResolver = createSecretResolver();
    for (let index = 0; index < config.providers.length; index += 1) {
      const provider = config.providers[index];
      if (provider.enabled === false || !provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()) {
        continue;
      }
      const environmentName = `PIWIN_SOAK_RPC_PROVIDER_${index}_KEY`;
      process.env[environmentName] = await secretResolver.resolveProviderSecret(provider);
      temporarySecretEnvNames.push(environmentName);
      provider.apiKeyEnv = environmentName;
    }
  }
  config.hostMode = options.mode;
  config.session = {
    ...(config.session ?? {}),
    autoName: false,
    runtimeRetention: {
      idleTtlSeconds: options.idleTtlSeconds,
      maxIdleRuntimes: options.maxIdleRuntimes,
      maxResidentRuntimes: options.maxResidentRuntimes,
      ...(options.memoryHighWaterMiB === undefined
        ? {}
        : { memoryHighWaterMiB: options.memoryHighWaterMiB }),
    },
  };
  await savePiwinConfig(config, runRoot);

  runtime = new HostRuntime({
    mode: options.mode,
    mock: false,
    piwinRoot: runRoot,
    ...(options.mode === 'rpc' ? { agentWorkerScript: resolve('dist-host/agent-worker.mjs') } : {}),
    onPush: (push) => {
      if (push.type === 'run/terminal') {
        terminalRuns.set(push.run.runId, push.run);
        const waiter = terminalWaiters.get(push.run.runId);
        if (waiter !== undefined) {
          terminalWaiters.delete(push.run.runId);
          waiter.resolve(push.run);
        }
      }
    },
  });

  samplerPromise = sampleLoop();
  await requireSuccess(
    runtime.handleCommand({ type: 'project/open', path: projectPath }),
    'project/open',
  );
  await requireSuccess(
    runtime.handleCommand({ type: 'project/trust', path: projectPath }),
    'project/trust',
  );

  const sessionIds = [];
  for (let index = 0; index < options.sessions; index += 1) {
    const created = await requireSuccess(
      runtime.handleCommand({
        type: 'session/create',
        input: { projectPath, sessionName: `native-soak-${options.mode}-${index + 1}` },
      }),
      `session/create ${index + 1}`,
    );
    sessionIds.push(created.sessionId);
  }

  phase = 'soak';
  soakStartedAt = new Date();
  const deadlineMs = soakStartedAt.getTime() + options.durationMinutes * 60_000;
  while (Date.now() < deadlineMs) {
    const cycleStartedAt = Date.now();
    const sessionId = sessionIds[cycle % sessionIds.length];
    cycle += 1;
    try {
      // History-only navigation must remain a bounded durable read and must not
      // allocate another runtime before the prompt admission below.
      await requireSuccess(
        runtime.handleCommand({ type: 'session/resume', sessionId }),
        `session/resume cycle ${cycle}`,
      );
      const accepted = await requireSuccess(
        runtime.handleCommand({
          type: 'session/prompt',
          sessionId,
          input: {
            text:
              `Native ${options.mode.toUpperCase()} residency soak cycle ${cycle}. ` +
              'Do not call tools. Reply with exactly: OK',
          },
        }),
        `session/prompt cycle ${cycle}`,
      );
      const terminal = await waitForTerminal(accepted.runId, options.promptTimeoutSeconds * 1000);
      if (terminal.status !== 'completed') {
        throw new Error(
          `run ${terminal.runId} terminalized as ${terminal.status}/${terminal.terminalCode ?? 'unknown'}`,
        );
      }
    } catch (error) {
      const message = formatUnknownError(error);
      failures.push({ cycle, at: new Date().toISOString(), message });
      process.stderr.write(`[soak:${options.mode}] cycle ${cycle} failed: ${message}\n`);
      if (failures.length >= options.maxFailures) {
        throw new Error(`soak stopped after ${failures.length} failures`);
      }
    }
    const remainingIntervalMs =
      options.promptIntervalSeconds * 1000 - (Date.now() - cycleStartedAt);
    if (remainingIntervalMs > 0 && Date.now() < deadlineMs) {
      await delay(Math.min(remainingIntervalMs, deadlineMs - Date.now()));
    }
  }

  phase = 'pre-dispose';
  await sampleOnce();
} catch (error) {
  failures.push({ cycle, at: new Date().toISOString(), message: formatUnknownError(error) });
} finally {
  sampling = false;
  if (samplerPromise !== undefined) {
    await samplerPromise.catch((error) => {
      failures.push({ cycle, at: new Date().toISOString(), message: formatUnknownError(error) });
    });
  }
  phase = 'dispose';
  if (runtime !== undefined) {
    try {
      await runtime.dispose();
    } catch (error) {
      failures.push({ cycle, at: new Date().toISOString(), message: formatUnknownError(error) });
    }
  }
}

await delay(1_000);
const aliveWorkerPids = [...observedWorkerPids].filter(isProcessAlive);
const summary = buildSummary({
  mode: options.mode,
  startedAt,
  soakStartedAt,
  endedAt: new Date(),
  cycles: cycle,
  samples,
  failures,
  observedWorkerPids: [...observedWorkerPids],
  aliveWorkerPids,
  policy: {
    idleTtlSeconds: options.idleTtlSeconds,
    maxIdleRuntimes: options.maxIdleRuntimes,
    maxResidentRuntimes: options.maxResidentRuntimes,
    ...(options.memoryHighWaterMiB === undefined
      ? {}
      : { memoryHighWaterMiB: options.memoryHighWaterMiB }),
  },
});
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await rm(runRoot, { recursive: true, force: true });
for (const environmentName of temporarySecretEnvNames) {
  delete process.env[environmentName];
}

process.stdout.write(
  `${JSON.stringify({ csvPath, summaryPath, verdict: summary.verdict, cycles: cycle })}\n`,
);
if (summary.verdict !== 'pass') {
  process.exitCode = 1;
}

async function sampleLoop() {
  while (sampling) {
    await sampleOnce();
    await delay(options.sampleSeconds * 1000);
  }
}

async function sampleOnce() {
  if (runtime === undefined) return;
  const response = await runtime.handleCommand({ type: 'host/runtime-resources' });
  if (!response.success) {
    throw new Error(`host/runtime-resources: ${response.error}`);
  }
  const descendants = await sampleDescendantProcesses(process.pid);
  for (const processRow of descendants) {
    if (processRow.kind === 'rpc-worker') observedWorkerPids.add(processRow.pid);
  }
  const data = response.data;
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt.getTime()) / 1000);
  const descendantRssMiB = roundMiB(
    descendants.reduce((total, processRow) => total + processRow.rssKiB, 0) / 1024,
  );
  const workerPids = descendants
    .filter((processRow) => processRow.kind === 'rpc-worker')
    .map((processRow) => processRow.pid)
    .sort((left, right) => left - right);
  const sample = {
    timestamp: new Date().toISOString(),
    elapsedSeconds,
    phase,
    cycle,
    hostRssMiB: data.memory.hostRssMiB,
    workerRssMiB: data.memory.workerRssMiB ?? 0,
    aggregateRssMiB: data.memory.hostRssMiB + (data.memory.workerRssMiB ?? 0),
    sampleCompleteness: data.memory.sampleCompleteness,
    resident: data.counts.resident,
    idle: data.counts.idle,
    busy: data.counts.busy,
    activating: data.counts.activating,
    suspending: data.counts.suspending,
    waiters: data.waiterCount,
    maxResident: data.budget.maxResidentRuntimes,
    maxIdle: data.budget.maxIdleRuntimes,
    highWaterMiB: data.budget.memoryHighWaterMiB,
    evictedIdleTtl: data.counters.evictedByIdleTtl,
    evictedMaxIdle: data.counters.evictedByMaxIdle,
    evictedMaxResident: data.counters.evictedByMaxResident,
    evictedMemory: data.counters.evictedByMemoryPressure,
    memoryPressureFailures: data.counters.memoryPressureFailures,
    descendantCount: descendants.length,
    descendantRssMiB,
    workerPids,
  };
  samples.push(sample);
  await appendFile(csvPath, `${CSV_COLUMNS.map((column) => csvValue(sample[column])).join(',')}\n`);
}

async function sampleDescendantProcesses(rootPid) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss=,command='], {
    maxBuffer: 4 * 1024 * 1024,
  });
  const rows = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (match === null) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKiB: Number(match[3]),
        command: match[4],
      };
    })
    .filter((row) => row !== null);
  const descendants = [];
  const parentPids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (parentPids.has(row.ppid) && !parentPids.has(row.pid)) {
        parentPids.add(row.pid);
        descendants.push({
          pid: row.pid,
          ppid: row.ppid,
          rssKiB: row.rssKiB,
          kind: /rpc-sdk-worker-entry|piwin-agent-worker|agent-worker\.mjs/.test(row.command)
            ? 'rpc-worker'
            : 'child',
        });
        changed = true;
      }
    }
  }
  return descendants;
}

function waitForTerminal(runId, timeoutMs) {
  const completed = terminalRuns.get(runId);
  if (completed !== undefined) {
    terminalRuns.delete(runId);
    return Promise.resolve(completed);
  }
  return new Promise((resolveTerminal, rejectTerminal) => {
    const timeout = setTimeout(() => {
      terminalWaiters.delete(runId);
      rejectTerminal(new Error(`run ${runId} did not terminalize within ${timeoutMs}ms`));
    }, timeoutMs);
    terminalWaiters.set(runId, {
      resolve: (run) => {
        clearTimeout(timeout);
        terminalRuns.delete(runId);
        resolveTerminal(run);
      },
    });
  });
}

async function requireSuccess(responsePromise, label) {
  const response = await responsePromise;
  if (!response.success) throw new Error(`${label}: ${response.error}`);
  return response.data;
}

function buildSummary(input) {
  const aggregate = input.samples.map((sample) => sample.aggregateRssMiB);
  const elapsed = input.samples.map((sample) => sample.elapsedSeconds);
  const maxResidentOverBudget = input.samples.some(
    (sample) => sample.resident > sample.maxResident,
  );
  const maxIdleOverBudget = input.samples.some((sample) => sample.idle > sample.maxIdle);
  // SDK has no worker RSS component, so Host-only sampling is still complete.
  // RPC is complete only when every active worker answered the bounded query.
  const completenessExpected = input.samples.every(
    (sample) => sample.sampleCompleteness === 'complete',
  );
  const pass =
    input.cycles > 0 &&
    input.failures.length === 0 &&
    !maxResidentOverBudget &&
    !maxIdleOverBudget &&
    input.aliveWorkerPids.length === 0 &&
    completenessExpected;
  return {
    schemaVersion: 1,
    mode: input.mode,
    nativeBackend: true,
    startedAt: input.startedAt.toISOString(),
    soakStartedAt: input.soakStartedAt?.toISOString() ?? null,
    endedAt: input.endedAt.toISOString(),
    elapsedMinutes: round((input.endedAt.getTime() - input.startedAt.getTime()) / 60_000, 3),
    soakElapsedMinutes:
      input.soakStartedAt === undefined
        ? 0
        : round((input.endedAt.getTime() - input.soakStartedAt.getTime()) / 60_000, 3),
    cycles: input.cycles,
    sampleCount: input.samples.length,
    policy: input.policy,
    rssMiB: {
      firstAggregate: aggregate[0] ?? null,
      lastAggregate: aggregate.at(-1) ?? null,
      minimumAggregate: aggregate.length === 0 ? null : Math.min(...aggregate),
      maximumAggregate: aggregate.length === 0 ? null : Math.max(...aggregate),
      p95Aggregate: percentile(aggregate, 0.95),
      linearSlopeMiBPerHour: linearSlope(elapsed, aggregate) * 3600,
    },
    residency: {
      maximumResident: maximum(input.samples.map((sample) => sample.resident)),
      maximumIdle: maximum(input.samples.map((sample) => sample.idle)),
      maximumBusy: maximum(input.samples.map((sample) => sample.busy)),
      maximumWaiters: maximum(input.samples.map((sample) => sample.waiters)),
      maxResidentOverBudget,
      maxIdleOverBudget,
      finalCounters: input.samples.at(-1)
        ? {
            evictedIdleTtl: input.samples.at(-1).evictedIdleTtl,
            evictedMaxIdle: input.samples.at(-1).evictedMaxIdle,
            evictedMaxResident: input.samples.at(-1).evictedMaxResident,
            evictedMemory: input.samples.at(-1).evictedMemory,
            memoryPressureFailures: input.samples.at(-1).memoryPressureFailures,
          }
        : null,
    },
    sampling: {
      expectedCompleteness: 'complete',
      completenessExpected,
    },
    processLifecycle: {
      observedWorkerPids: input.observedWorkerPids.sort((left, right) => left - right),
      aliveWorkerPidsAfterDispose: input.aliveWorkerPids.sort((left, right) => left - right),
    },
    failures: input.failures,
    verdict: pass ? 'pass' : 'fail',
  };
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const key = argumentsList[index];
    if (key === '--') continue;
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    values.set(key.slice(2), value);
    index += 1;
  }
  const mode = values.get('mode');
  if (mode !== 'sdk' && mode !== 'rpc') throw new Error('--mode must be sdk or rpc');
  return {
    mode,
    durationMinutes: positiveNumber(values.get('duration-minutes') ?? '30', 'duration-minutes'),
    sampleSeconds: positiveNumber(values.get('sample-seconds') ?? '5', 'sample-seconds'),
    promptIntervalSeconds: positiveNumber(
      values.get('prompt-interval-seconds') ?? '60',
      'prompt-interval-seconds',
    ),
    promptTimeoutSeconds: positiveNumber(
      values.get('prompt-timeout-seconds') ?? '120',
      'prompt-timeout-seconds',
    ),
    sessions: positiveInteger(values.get('sessions') ?? '6', 'sessions'),
    idleTtlSeconds: nonNegativeInteger(values.get('idle-ttl-seconds') ?? '45', 'idle-ttl-seconds'),
    maxIdleRuntimes: nonNegativeInteger(values.get('max-idle') ?? '1', 'max-idle'),
    maxResidentRuntimes: positiveInteger(values.get('max-resident') ?? '2', 'max-resident'),
    memoryHighWaterMiB:
      values.get('memory-high-water-mib') === undefined
        ? undefined
        : positiveInteger(values.get('memory-high-water-mib'), 'memory-high-water-mib'),
    maxFailures: positiveInteger(values.get('max-failures') ?? '3', 'max-failures'),
    sourcePiwinRoot: values.get('source-piwin-root'),
    project: values.get('project'),
    output: values.get('output'),
  };
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${label} must be > 0`);
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`--${label} must be >= 0`);
  return parsed;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${label} must be > 0`);
  return parsed;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function linearSlope(xValues, yValues) {
  if (xValues.length < 2 || xValues.length !== yValues.length) return 0;
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const meanY = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xValues.length; index += 1) {
    const deltaX = xValues[index] - meanX;
    numerator += deltaX * (yValues[index] - meanY);
    denominator += deltaX * deltaX;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function maximum(values) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function roundMiB(value) {
  return round(value, 2);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function dateStamp(date) {
  return date.toISOString().replaceAll(':', '').replaceAll('.', '-');
}

function formatUnknownError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, milliseconds)));
}
