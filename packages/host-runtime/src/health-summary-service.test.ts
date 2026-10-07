import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AppleHealthRecord,
  HealthConfig,
  HealthSummarySyncBatchV1,
  HostCommand,
  HostResponse,
  PiwinConfig,
} from '@piwin/contracts';
import { APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, createDefaultHealthConfig } from '@piwin/contracts';
import { createHealthReadContextTool } from './health-read-context-tool.js';
import { HealthSummaryService, HealthSummaryStorageDisabledError } from './health-summary-service.js';
import { HealthToolRunBudget } from './health-tool-run-budget.js';

const roots: string[] = [];
const MODEL = { providerId: 'local', modelId: 'digest-model' };

type Harness = {
  service: HealthSummaryService;
  commands: HostCommand[];
  setNow: (iso: string) => void;
  health: HealthConfig;
};

async function createHarness(mutate: (health: HealthConfig) => void = () => undefined): Promise<Harness> {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-health-service-'));
  roots.push(piwinRoot);
  const health = createDefaultHealthConfig();
  health.summaryStore.enabled = true;
  mutate(health);
  const commands: HostCommand[] = [];
  let now = new Date('2026-10-07T01:00:00.000Z');
  const service = new HealthSummaryService({
    piwinRoot,
    loadConfig: async () => ({ health }) as PiwinConfig,
    runCommand: async (command): Promise<HostResponse> => {
      commands.push(command);
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: command.type === 'session/create' ? { sessionId: 'digest-session' } : undefined,
      };
    },
    now: () => now,
  });
  return { service, commands, health, setNow: (iso) => (now = new Date(iso)) };
}

function steps(localDate: string, value: number): AppleHealthRecord {
  return { metric: 'steps', localDate, unit: 'count', value, freshAsOf: '2026-10-07T00:30:00.000Z' };
}

function monthOfSteps(generatedAt = '2026-10-07T00:30:00.000Z'): HealthSummarySyncBatchV1 {
  const records: AppleHealthRecord[] = [];
  for (let day = 7; day <= 30; day += 1) {
    records.push(steps(`2026-09-${String(day).padStart(2, '0')}`, 8000));
  }
  for (let day = 1; day <= 6; day += 1) {
    records.push(steps(`2026-10-0${day}`, 8000));
  }
  records.push(steps('2026-10-07', 1500));
  return {
    schemaVersion: 1,
    batchId: 'batch-1',
    generatedAt,
    timeZone: 'Asia/Shanghai',
    startDate: '2026-09-07',
    endDateExclusive: '2026-10-08',
    metrics: ['steps'],
    records,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('HealthSummaryService storage', () => {
  it('refuses to store anything until the user turns storage on', async () => {
    const { service } = await createHarness((health) => {
      health.summaryStore.enabled = false;
    });
    await expect(service.sync('device-a', monthOfSteps())).rejects.toBeInstanceOf(
      HealthSummaryStorageDisabledError,
    );
    expect((await service.status()).devices).toEqual([]);
    expect(await service.readCached({ metrics: ['steps'], range: { preset: 'today' } })).toBeUndefined();
  });

  it('answers a read from stored summaries, with baselines computed on the Host', async () => {
    const { service } = await createHarness();
    await service.sync('device-a', monthOfSteps());
    const cached = await service.readCached({
      metrics: ['steps', 'sleep-duration'],
      range: { preset: 'last-7-days' },
      includeBaseline: true,
    });
    expect(cached?.records.map((record) => record.localDate)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    expect(cached?.warnings).toEqual(['host-cache', 'partial-result']);
    expect(cached?.unavailableMetrics).toEqual([
      { metric: 'sleep-duration', reason: 'not-authorized-or-no-data' },
    ]);
    expect(cached?.startAt).toBe('2026-09-30T16:00:00.000Z');
    expect(cached?.baselines?.[0]).toMatchObject({
      metric: 'steps',
      sampleDays: 30,
      mean: 8000,
      latest: { localDate: '2026-10-07', value: 1500, partialDay: true },
    });
  });

  it('lets the health tool exist and answer while no phone is connected', async () => {
    const { service } = await createHarness();
    const port = service.wrapExecutionPort({
      hasCapableDevice: () => false,
      execute: async () => ({ ok: false, reason: 'client-device-unavailable', retryable: true }),
    });
    expect(port.hasCapableDevice(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID)).toBe(false);
    await service.sync('device-a', monthOfSteps());
    expect(port.hasCapableDevice(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID)).toBe(true);
    expect(port.hasCapableDevice('something-else')).toBe(false);

    const tool = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      execution: port,
      readCache: (request) => service.readCached(request),
    });
    const result = await tool.execute(
      { metrics: ['steps'], range: { preset: 'today' } },
      new AbortController().signal,
      { sessionId: 's', runtimeGenerationId: 'g', runId: 'r', toolCallId: 't', toolName: 'health_read_context' },
    );
    expect(result.ok && result.output).toContain('steps 2026-10-07 1500 count');
    expect(result.ok && result.output).toContain('served from summaries stored on the Host');
  });

  it('never substitutes the cache when the user denied the read', async () => {
    const { service } = await createHarness();
    await service.sync('device-a', monthOfSteps());
    const tool = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      execution: {
        hasCapableDevice: () => true,
        execute: async () => ({ ok: false, reason: 'permission-denied', retryable: false }),
      },
      readCache: (request) => service.readCached(request),
    });
    const result = await tool.execute(
      { metrics: ['steps'], range: { preset: 'today' } },
      new AbortController().signal,
      { sessionId: 's', runtimeGenerationId: 'g', runId: 'r', toolCallId: 't', toolName: 'health_read_context' },
    );
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' });
  });
});

describe('HealthSummaryService digest', () => {
  const withDigest = (health: HealthConfig): void => {
    health.digest = { ...health.digest, enabled: true, model: MODEL, metrics: ['steps'], time: '08:00' };
  };

  it('opens a session on the chosen model and sends one prompt built from stored data', async () => {
    const { service, commands } = await createHarness(withDigest);
    await service.sync('device-a', monthOfSteps());
    const outcome = await service.runDigest('manual');
    expect(outcome).toMatchObject({ ok: true, sessionId: 'digest-session' });
    expect(commands.map((command) => command.type)).toEqual(['session/create', 'session/prompt']);
    const create = commands[0];
    expect(create?.type === 'session/create' && create.input).toMatchObject({
      scope: { kind: 'general' },
      model: MODEL,
      sessionName: '健康晨报 2026-10-07',
    });
    const prompt = commands[1];
    const text = prompt?.type === 'session/prompt' ? prompt.input.text : '';
    expect(text).toContain('steps 2026-10-07 1500 count');
    expect(text).toContain('baseline steps');
    expect((await service.status()).digest).toMatchObject({ lastStatus: 'ok', lastSessionId: 'digest-session' });
  });

  it('cannot run without a chosen model and never picks one itself', async () => {
    const { service, commands } = await createHarness((health) => {
      health.digest = { ...health.digest, enabled: true, model: null };
    });
    await service.sync('device-a', monthOfSteps());
    const outcome = await service.runDigest('manual');
    expect(outcome).toMatchObject({ ok: false, status: 'error', message: 'no digest model is selected' });
    expect(commands).toEqual([]);
  });

  it('holds a scheduled digest until the phone syncs that day, then runs anyway after the grace period', async () => {
    const { service, commands, setNow } = await createHarness(withDigest);
    await service.sync('device-a', monthOfSteps('2026-10-06T10:00:00.000Z'));
    const slot = new Date(2026, 9, 7, 8, 0);
    setNow(new Date(slot.getTime() + 10 * 60_000).toISOString());
    const waiting = await service.runDigest('scheduled');
    expect(waiting).toMatchObject({ status: 'skipped', message: 'waiting for the phone to sync today' });
    expect(commands).toEqual([]);
    expect((await service.status()).digest.lastRunAt).toBeUndefined();

    setNow(new Date(slot.getTime() + 4 * 60 * 60_000).toISOString());
    const late = await service.runDigest('scheduled');
    expect(late.ok).toBe(true);
    const prompt = commands[1];
    expect(prompt?.type === 'session/prompt' && prompt.input.text).toContain('手机今天还没有同步过');
  });

  it('skips when nothing has been synced', async () => {
    const { service, commands } = await createHarness(withDigest);
    expect(await service.runDigest('manual')).toMatchObject({ ok: false, status: 'skipped' });
    expect(commands).toEqual([]);
  });
});
