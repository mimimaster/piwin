import { describe, expect, it } from 'vitest';
import type { ClientToolExecutionPort, HostToolExecutionContext } from '@piwin/contracts';
import {
  createHealthReadContextTool,
  formatHealthModelOutput,
  isHealthSensitiveToolResult,
} from './health-read-context-tool.js';
import { HealthToolRunBudget } from './health-tool-run-budget.js';
import { resolveToolPolicy } from './capabilities/tool-policy-resolver.js';
import { buildSessionHostTools } from './tools/build-session-host-tools.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

const CONTEXT: HostToolExecutionContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'gen-1',
  runId: 'run-1',
  toolCallId: 'tool-1',
  toolName: 'health_read_context',
};

function fakePort(
  outcome: Awaited<ReturnType<ClientToolExecutionPort['execute']>>,
): ClientToolExecutionPort {
  return {
    execute: async () => outcome,
    hasCapableDevice: () => true,
  };
}

describe('health_read_context', () => {
  it('rejects a window longer than 90 days before calling the broker', async () => {
    const budget = new HealthToolRunBudget();
    let called = 0;
    const tool = createHealthReadContextTool({
      budget,
      execution: {
        hasCapableDevice: () => true,
        execute: async () => {
          called += 1;
          return { ok: false, reason: 'client-device-unavailable', retryable: true };
        },
      },
    });
    const prepared = await tool.prepareArgs?.(
      {
        metrics: ['steps'],
        range: { preset: 'custom', startDate: '2026-01-01', endDateExclusive: '2026-08-01' },
      },
      CONTEXT,
      new AbortController().signal,
    );
    expect(prepared?.ok).toBe(false);
    expect(called).toBe(0);
  });

  it('admits one call per Run and maps missing metrics as unknown, never zero', async () => {
    const budget = new HealthToolRunBudget();
    const tool = createHealthReadContextTool({
      budget,
      execution: fakePort({
        ok: true,
        deviceId: 'device-a',
        completedAt: '2026-08-23T12:00:00.000Z',
        result: {
          schemaVersion: 1,
          source: 'apple-health',
          timeZone: 'Asia/Shanghai',
          startAt: '2026-08-16T16:00:00.000Z',
          endAt: '2026-08-23T16:00:00.000Z',
          generatedAt: '2026-08-23T12:00:00.000Z',
          records: [
            {
              metric: 'steps',
              localDate: '2026-08-22',
              unit: 'count',
              value: 8123,
              freshAsOf: '2026-08-23T08:00:00.000Z',
            },
          ],
          unavailableMetrics: [{ metric: 'sleep-duration', reason: 'not-authorized-or-no-data' }],
          warnings: ['partial-result'],
        },
      }),
    });
    const prepared = await tool.prepareArgs?.(
      { metrics: ['steps', 'sleep-duration'], range: { preset: 'last-7-days' } },
      CONTEXT,
      new AbortController().signal,
    );
    expect(prepared?.ok).toBe(true);
    if (prepared?.ok !== true) {
      throw new Error('expected prepared args');
    }
    const result = await tool.execute(prepared.arguments, new AbortController().signal, CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.details?.sensitivity).toBe('health');
      expect(result.output).toContain('user-authorized Apple Health summaries');
      expect(result.output).toContain('steps 2026-08-22 8123 count');
      expect(result.output).toContain('sleep-duration unavailable');
      expect(result.output).not.toMatch(/sleep-duration 0 /);
      expect(isHealthSensitiveToolResult(result.details)).toBe(true);
    }

    const second = await tool.execute(prepared.arguments, new AbortController().signal, CONTEXT);
    expect(second).toMatchObject({
      ok: false,
      code: 'tool-not-available',
      details: { reason: 'health-call-budget-exhausted' },
    });
    budget.release('run-1');
    const afterTerminal = await tool.execute(
      prepared.arguments,
      new AbortController().signal,
      { ...CONTEXT, runId: 'run-1' },
    );
    expect(afterTerminal.ok).toBe(true);
  });

  it('maps broker outcomes to ToolResult codes', async () => {
    const cases: Array<{
      reason: 'permission-denied' | 'cancelled' | 'client-tool-timeout' | 'no-accessible-data';
      retryable: boolean;
      code: string;
    }> = [
      { reason: 'permission-denied', retryable: false, code: 'permission-denied' },
      { reason: 'cancelled', retryable: false, code: 'aborted' },
      { reason: 'client-tool-timeout', retryable: true, code: 'tool-not-available' },
      { reason: 'no-accessible-data', retryable: false, code: 'tool-not-available' },
    ];
    for (const item of cases) {
      const tool = createHealthReadContextTool({
        budget: new HealthToolRunBudget(),
        execution: fakePort({ ok: false, reason: item.reason, retryable: item.retryable }),
      });
      const result = await tool.execute(
        { metrics: ['steps'], range: { preset: 'today' }, granularity: 'summary' },
        new AbortController().signal,
        { ...CONTEXT, runId: `run-${item.reason}` },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(item.code);
        if (item.reason === 'cancelled') {
          expect(result.cancelled).toBe(true);
        }
        if (item.retryable) {
          expect(result.retryable).toBe(true);
        }
        expect(result.details?.health?.status).toBeDefined();
      }
    }
  });

  it('rejects empty records and out-of-window dates as invalid client results', async () => {
    const empty = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      execution: fakePort({
        ok: true,
        deviceId: 'device-a',
        completedAt: '2026-08-23T12:00:00.000Z',
        result: {
          schemaVersion: 1,
          source: 'apple-health',
          timeZone: 'UTC',
          startAt: '2026-08-23T00:00:00.000Z',
          endAt: '2026-08-24T00:00:00.000Z',
          generatedAt: '2026-08-23T12:00:00.000Z',
          records: [],
          unavailableMetrics: [],
          warnings: [],
        },
      }),
    });
    const emptyResult = await empty.execute(
      { metrics: ['steps'], range: { preset: 'today' }, granularity: 'summary' },
      new AbortController().signal,
      { ...CONTEXT, runId: 'run-empty' },
    );
    expect(emptyResult).toMatchObject({
      ok: false,
      code: 'execution-failed',
      details: { reason: 'invalid-client-result', health: { status: 'failed' } },
    });

    const outOfWindow = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      execution: fakePort({
        ok: true,
        deviceId: 'device-a',
        completedAt: '2026-08-23T12:00:00.000Z',
        result: {
          schemaVersion: 1,
          source: 'apple-health',
          timeZone: 'UTC',
          startAt: '2026-08-23T00:00:00.000Z',
          endAt: '2026-08-24T00:00:00.000Z',
          generatedAt: '2026-08-23T12:00:00.000Z',
          records: [
            {
              metric: 'steps',
              localDate: '2020-01-01',
              unit: 'count',
              value: 10,
              freshAsOf: '2026-08-23T12:00:00.000Z',
            },
          ],
          unavailableMetrics: [],
          warnings: [],
        },
      }),
    });
    const outOfWindowResult = await outOfWindow.execute(
      { metrics: ['steps'], range: { preset: 'today' }, granularity: 'summary' },
      new AbortController().signal,
      { ...CONTEXT, runId: 'run-window' },
    );
    expect(outOfWindowResult).toMatchObject({
      ok: false,
      details: { reason: 'invalid-client-result', health: { status: 'failed' } },
    });

    const futureFreshness = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      execution: fakePort({
        ok: true,
        deviceId: 'device-a',
        completedAt: '2026-08-23T12:00:00.000Z',
        result: {
          schemaVersion: 1,
          source: 'apple-health',
          timeZone: 'UTC',
          startAt: '2026-08-23T00:00:00.000Z',
          endAt: '2026-08-24T00:00:00.000Z',
          generatedAt: '2026-08-23T12:00:00.000Z',
          records: [
            {
              metric: 'steps',
              localDate: '2026-08-23',
              unit: 'count',
              value: 10,
              freshAsOf: '2026-08-23T13:00:00.000Z',
            },
          ],
          unavailableMetrics: [],
          warnings: [],
        },
      }),
    });
    const futureFreshnessResult = await futureFreshness.execute(
      { metrics: ['steps'], range: { preset: 'today' }, granularity: 'summary' },
      new AbortController().signal,
      { ...CONTEXT, runId: 'run-skew' },
    );
    expect(futureFreshnessResult).toMatchObject({
      ok: false,
      details: { reason: 'invalid-client-result', health: { status: 'failed' } },
    });
  });

  it('threads explicit @Health intent and provider into the client-tool display', async () => {
    let display: unknown;
    const tool = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      resolveDisplay: () => ({
        explicitTurnIntent: true,
        provider: { id: 'local-ollama', label: 'Ollama', processing: 'local' },
      }),
      execution: {
        hasCapableDevice: () => true,
        execute: async (request) => {
          display = request.display;
          return { ok: false, reason: 'cancelled', retryable: false };
        },
      },
    });
    await tool.execute(
      { metrics: ['steps'], range: { preset: 'today' }, granularity: 'summary' },
      new AbortController().signal,
      CONTEXT,
    );
    expect(display).toMatchObject({
      explicitTurnIntent: true,
      provider: { id: 'local-ollama', processing: 'local' },
    });
  });

  it('registers health_read_context on a root session that has a parent subagent seam', async () => {
    const tool = createHealthReadContextTool({
      execution: {
        hasCapableDevice: () => true,
        execute: async () => ({ ok: false, reason: 'cancelled', retryable: false }),
      },
      budget: new HealthToolRunBudget(),
    });
    expect(tool.descriptor.name).toBe('health_read_context');
  });

  it('exposes device-health only for root sessions when the family is available', () => {
    const availability = {
      webSearchReady: false,
      webFetchReady: false,
      mcpEnabledServerIds: [],
      processReady: false,
      browserReady: false,
      imageGenerationReady: false,
      videoGenerationReady: false,
    };
    const root = resolveToolPolicy({
      webSearch: false,
      webFetch: false,
      mcp: false,
      imageGeneration: false,
      videoGeneration: false,
      process: 'off',
      browser: 'off',
      subagents: 'off',
      notes: 'off',
      flashcards: 'off',
      availability,
      deviceHealth: true,
      availableFamilies: new Set(['device-health']),
    });
    expect(root.enabledFamilies).toContain('device-health');

    const child = resolveToolPolicy({
      webSearch: false,
      webFetch: false,
      mcp: false,
      imageGeneration: false,
      videoGeneration: false,
      process: 'off',
      browser: 'off',
      subagents: 'off',
      notes: 'off',
      flashcards: 'off',
      availability,
      deviceHealth: true,
      capabilities: ['read'],
      availableFamilies: new Set(['device-health']),
    });
    expect(child.enabledFamilies).not.toContain('device-health');
  });

  it('formats model text from validated records only', () => {
    const output = formatHealthModelOutput({
      schemaVersion: 1,
      source: 'apple-health',
      timeZone: 'UTC',
      startAt: '2026-08-23T00:00:00.000Z',
      endAt: '2026-08-24T00:00:00.000Z',
      generatedAt: '2026-08-23T12:00:00.000Z',
      records: [
        {
          metric: 'steps',
          localDate: '2026-08-23',
          unit: 'count',
          value: 10,
          freshAsOf: '2026-08-23T12:00:00.000Z',
        },
      ],
      unavailableMetrics: [],
      warnings: [],
    });
    expect(output.startsWith('These values are user-authorized Apple Health summaries')).toBe(true);
    expect(output).not.toContain('the user has arrhythmia');
  });
  it('renders hourly buckets, sleep clock times and baselines for the model', () => {
    const output = formatHealthModelOutput({
      schemaVersion: 1,
      source: 'apple-health',
      timeZone: 'Asia/Shanghai',
      startAt: '2026-10-06T16:00:00.000Z',
      endAt: '2026-10-07T16:00:00.000Z',
      generatedAt: '2026-10-07T04:00:00.000Z',
      records: [
        {
          metric: 'steps',
          localDate: '2026-10-07',
          localHour: 9,
          unit: 'count',
          value: 512,
          freshAsOf: '2026-10-07T04:00:00.000Z',
        },
        {
          metric: 'sleep-schedule',
          localDate: '2026-10-07',
          unit: 'minute',
          value: 420,
          components: { 'bedtime-minutes-after-noon': 780, 'wake-minute-of-day': 480 },
          freshAsOf: '2026-10-07T04:00:00.000Z',
        },
      ],
      unavailableMetrics: [],
      warnings: [],
      baselines: [
        {
          metric: 'steps',
          unit: 'count',
          startDate: '2026-09-07',
          endDateExclusive: '2026-10-07',
          sampleDays: 28,
          mean: 8000,
          stdDev: 1500,
          min: 4200,
          max: 12100,
          latest: { localDate: '2026-10-07', value: 3100, deltaPercent: -61.25, zScore: -3.27, partialDay: true },
        },
        {
          metric: 'sleep-schedule',
          component: 'bedtime-minutes-after-noon',
          unit: 'minute',
          startDate: '2026-09-07',
          endDateExclusive: '2026-10-07',
          sampleDays: 25,
          mean: 690,
          stdDev: 22.5,
          min: 650,
          max: 760,
          latest: { localDate: '2026-10-07', value: 780, deltaPercent: 13.04, zScore: 4 },
        },
      ],
    });
    expect(output).toContain('steps 2026-10-07T09 512 count');
    expect(output).toContain('sleep-schedule 2026-10-07 420 minute');
    expect(output).toContain('bedtime=01:00 wake=08:00');
    expect(output).toContain(
      'baseline steps 2026-09-07/2026-10-07 days=28 mean=8000 sd=1500 min=4200 max=12100 unit=count ' +
        'latest=2026-10-07:3100 delta=-61.25% z=-3.27 partial-day',
    );
    expect(output).toContain(
      'baseline sleep-schedule.bedtime-minutes-after-noon 2026-09-07/2026-10-07 days=25 mean=23:30 sd=22.5 ' +
        'min=22:50 max=00:40 unit=minute latest=2026-10-07:01:00 z=4',
    );
  });

  it('suggests a chart only for a multi-day result in a session that renders Artifacts', async () => {
    const weekOfSteps = {
      ok: true as const,
      deviceId: 'device-a',
      completedAt: '2026-08-23T12:00:00.000Z',
      result: {
        schemaVersion: 1,
        source: 'apple-health',
        timeZone: 'Asia/Shanghai',
        startAt: '2026-08-16T16:00:00.000Z',
        endAt: '2026-08-23T16:00:00.000Z',
        generatedAt: '2026-08-23T12:00:00.000Z',
        records: ['17', '18', '19', '20', '21'].map((dayOfMonth) => ({
          metric: 'steps',
          localDate: `2026-08-${dayOfMonth}`,
          unit: 'count',
          value: 8000,
          freshAsOf: '2026-08-23T08:00:00.000Z',
        })),
        unavailableMetrics: [],
        warnings: [],
      },
    };
    const read = async (chartHint: boolean, records = weekOfSteps.result.records) => {
      const tool = createHealthReadContextTool({
        budget: new HealthToolRunBudget(),
        execution: fakePort({ ...weekOfSteps, result: { ...weekOfSteps.result, records } }),
        chartHint,
      });
      const result = await tool.execute(
        { metrics: ['steps'], range: { preset: 'last-7-days' } },
        new AbortController().signal,
        CONTEXT,
      );
      return result.ok ? result.output : '';
    };
    expect(await read(true)).toContain('artifact-html chart');
    expect(await read(false)).not.toContain('artifact-html');
    expect(await read(true, weekOfSteps.result.records.slice(0, 2))).not.toContain('artifact-html');
  });

  it('rejects baselines the Host did not ask for', async () => {
    const tool = createHealthReadContextTool({
      budget: new HealthToolRunBudget(),
      execution: fakePort({
        ok: true,
        deviceId: 'device-a',
        completedAt: '2026-08-23T12:00:00.000Z',
        result: {
          schemaVersion: 1,
          source: 'apple-health',
          timeZone: 'Asia/Shanghai',
          startAt: '2026-08-22T16:00:00.000Z',
          endAt: '2026-08-23T16:00:00.000Z',
          generatedAt: '2026-08-23T12:00:00.000Z',
          records: [
            {
              metric: 'steps',
              localDate: '2026-08-23',
              unit: 'count',
              value: 10,
              freshAsOf: '2026-08-23T08:00:00.000Z',
            },
          ],
          unavailableMetrics: [],
          warnings: [],
          baselines: [
            {
              metric: 'steps',
              unit: 'count',
              startDate: '2026-07-24',
              endDateExclusive: '2026-08-23',
              sampleDays: 20,
              mean: 8000,
              stdDev: 100,
              min: 7000,
              max: 9000,
            },
          ],
        },
      }),
    });
    const unasked = await tool.execute(
      { metrics: ['steps'], range: { preset: 'today' } },
      new AbortController().signal,
      CONTEXT,
    );
    expect(unasked).toMatchObject({ ok: false, details: { reason: 'invalid-client-result' } });
    const asked = await tool.execute(
      { metrics: ['steps'], range: { preset: 'today' }, includeBaseline: true },
      new AbortController().signal,
      { ...CONTEXT, runId: 'run-2' },
    );
    expect(asked.ok && asked.output).toContain('baseline steps 2026-07-24/2026-08-23 days=20');
  });
});
