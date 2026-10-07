import type {
  HealthReadContextArguments,
  AppleHealthBaseline,
  AppleHealthMetricId,
  AppleHealthReadResultV1,
  AppleHealthRecord,
  ClientToolExecutionOutcome,
  ClientToolExecutionPort,
  ClientToolRequestDisplay,
  HealthToolCardStatus,
  HealthToolCardSummary,
  HostToolExecutionContext,
  HostToolRegistration,
  ToolResult,
} from '@piwin/contracts';
import {
  APPLE_HEALTH_MAX_METRICS_PER_CALL,
  APPLE_HEALTH_METRIC_IDS,
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  CLIENT_TOOL_CLOCK_SKEW_MS,
  CLIENT_TOOL_DEFAULT_DEADLINE_MS,
  HEALTH_MODEL_OUTPUT_PREAMBLE,
  healthRequestedLocalDates,
  healthResultWindowMatchesRequest,
  isClientToolTimestampWithinSkew,
  parseAppleHealthReadResultV1,
  parseHealthReadContextArguments,
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
} from '@piwin/contracts';
import type { HealthToolRunBudget } from './health-tool-run-budget.js';

const METRIC_LABELS: Record<AppleHealthMetricId, string> = {
  steps: '步数',
  'active-energy': '活动能量',
  'exercise-minutes': '锻炼分钟',
  workouts: '训练',
  'sleep-duration': '睡眠时长',
  'sleep-stages': '睡眠分期',
  'resting-heart-rate': '静息心率',
  'heart-rate-variability': '心率变异性',
  'sleep-schedule': '入睡与起床时刻',
  'body-mass': '体重',
  'body-fat-percentage': '体脂率',
  'vo2-max': '最大摄氧量',
  'respiratory-rate': '呼吸频率',
  'blood-oxygen': '血氧',
  'wrist-temperature': '手腕温度',
  'mindful-minutes': '正念分钟',
  'time-in-daylight': '日照时间',
};

/** Outcomes that mean "no phone answered", as opposed to "the user said no". */
const PHONE_UNREACHABLE_REASONS: ReadonlySet<string> = new Set([
  'client-device-unavailable',
  'client-device-disconnected',
  'user-presence-required',
  'client-tool-timeout',
]);

const HOST_CACHE_NOTICE =
  'source-note: served from summaries stored on the Host at generatedAt because the phone was unreachable; ' +
  'today may be incomplete and hourly detail is unavailable. Say so in the answer.';

/** Fewer daily points than this is a number to state, not a trend to draw. */
const CHART_HINT_MIN_DAILY_POINTS = 5;
const HEALTH_CHART_HINT =
  'Presentation: these daily values form a trend. When the user asks how a metric changed over time, ' +
  'draw it as an inline artifact-html chart built from exactly the values above, and state the period in the caption.';

export type HealthReadContextDisplayResolver = (
  context: HostToolExecutionContext,
) => {
  explicitTurnIntent: boolean;
  provider?: ClientToolRequestDisplay['provider'];
};

export type HealthReadContextToolOptions = {
  execution: ClientToolExecutionPort;
  budget: HealthToolRunBudget;
  resolveDisplay?: HealthReadContextDisplayResolver;
  /** The session can render Artifacts, so a multi-day result may suggest a chart. */
  chartHint?: boolean;
  /**
   * Summaries the user chose to store on the Host. Consulted only after the
   * phone could not serve the read; a live answer always wins.
   */
  readCache?: (request: HealthReadContextArguments) => Promise<AppleHealthReadResultV1 | undefined>;
};

export function createHealthReadContextTool(
  options: HealthReadContextToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: 'health_read_context',
      description:
        'Read bounded Apple Health activity & biometric metrics from the paired device. ' +
        'Scope: Request only explicitly asked metrics within a <=90-day window. ' +
        'sleep-schedule returns the bedtime and wake time of each night. ' +
        'granularity "hour" (range today) adds hourly buckets for steps, active-energy, exercise-minutes and time-in-daylight. ' +
        'includeBaseline adds each metric\'s personal 30-day mean and spread plus how the latest day deviates; use it for "is this normal for me" questions. ' +
        'Data Contract: Treat missing/null values as unknown, never as zero. Report observation period. ' +
        'Boundary: Provide factual trends and descriptive summaries only. Never provide clinical diagnoses or medical advice.',
      parameters: {
        type: 'object',
        properties: {
          metrics: {
            type: 'array',
            items: {
              type: 'string',
              enum: [...APPLE_HEALTH_METRIC_IDS],
            },
            minItems: 1,
            maxItems: APPLE_HEALTH_MAX_METRICS_PER_CALL,
            description: 'Unique metric ids required for this question',
          },
          range: {
            type: 'object',
            description: 'Local-date window; total including comparison must be ≤ 90 days',
            properties: {
              preset: {
                type: 'string',
                enum: ['today', 'last-7-days', 'last-30-days', 'custom'],
              },
              startDate: { type: 'string', description: 'YYYY-MM-DD when preset is custom' },
              endDateExclusive: {
                type: 'string',
                description: 'YYYY-MM-DD exclusive end when preset is custom',
              },
            },
            required: ['preset'],
          },
          granularity: {
            type: 'string',
            enum: ['summary', 'day', 'hour'],
            description: '"hour" requires range preset "today" and no previous period',
          },
          includePreviousPeriod: { type: 'boolean' },
          includeBaseline: {
            type: 'boolean',
            description: 'Add the personal 30-day baseline of each metric, computed on the device',
          },
        },
        required: ['metrics', 'range'],
      },
    },
    family: 'device-health',
    permissionSpec: {
      action: 'device:health-read',
      risk: 'network',
      rememberable: false,
      // The Host permission engine allows this action outright: the decision
      // belongs to the phone (presence, consent, the OS grant). The subject
      // still has to be declared so admission never infers it from the name.
      subjectBuilder: () => ({ kind: 'tool', action: 'device:health-read' }),
    },
    prepareArgs: (rawArguments) => {
      const parsed = parseHealthReadContextArguments(rawArguments);
      if (!parsed.ok) {
        return {
          ok: false,
          result: {
            ok: false,
            code: 'invalid-input',
            message: parsed.reason,
          },
        };
      }
      return {
        ok: true,
        arguments: {
          metrics: parsed.value.metrics,
          range: parsed.value.range,
          granularity: parsed.value.granularity ?? 'summary',
          includePreviousPeriod: parsed.value.includePreviousPeriod ?? false,
          includeBaseline: parsed.value.includeBaseline ?? false,
        },
      };
    },
    execute: async (args, signal, context) => {
      if (!options.budget.tryAdmit(context.runId)) {
        return {
          ok: false,
          code: 'tool-not-available',
          message: 'Apple Health may be read once per turn',
          details: {
            reason: 'health-call-budget-exhausted',
            sensitivity: 'health',
            health: healthCard('failed', [], '选定范围'),
          },
        };
      }
      const parsed = parseHealthReadContextArguments(args);
      if (!parsed.ok) {
        return {
          ok: false,
          code: 'invalid-input',
          message: parsed.reason,
          details: { sensitivity: 'health', health: healthCard('failed', [], '选定范围') },
        };
      }
      const periodLabel = formatPeriodLabel(parsed.value.range);
      const metricLabels = parsed.value.metrics.map((metric) => METRIC_LABELS[metric]);
      const turn = options.resolveDisplay?.(context);
      const display: ClientToolRequestDisplay = {
        title: '读取 Apple Health',
        metricLabels,
        periodLabel,
        explicitTurnIntent: turn?.explicitTurnIntent === true,
      };
      if (turn?.provider !== undefined) {
        display.provider = turn.provider;
      }
      const outcome = await options.execution.execute(
        {
          capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
          sessionId: context.sessionId,
          runId: context.runId,
          toolCallId: context.toolCallId ?? context.runId,
          arguments: {
            metrics: parsed.value.metrics,
            range: parsed.value.range,
            granularity: parsed.value.granularity ?? 'summary',
            includePreviousPeriod: parsed.value.includePreviousPeriod ?? false,
            includeBaseline: parsed.value.includeBaseline ?? false,
          },
          deadlineMs: CLIENT_TOOL_DEFAULT_DEADLINE_MS,
          display,
        },
        signal,
      );
      if (!outcome.ok && PHONE_UNREACHABLE_REASONS.has(outcome.reason)) {
        const cached = await options.readCache?.(parsed.value);
        if (cached !== undefined) {
          return successResult(cached, parsed.value.metrics, periodLabel, options.chartHint === true);
        }
      }
      return mapHealthOutcome(outcome, parsed.value, periodLabel, options.chartHint === true);
    },
  };
}

export { isHealthSensitiveToolResult } from '@piwin/contracts';

function mapHealthOutcome(
  outcome: ClientToolExecutionOutcome,
  request: {
    metrics: readonly AppleHealthMetricId[];
    range: import('@piwin/contracts').HealthReadRange;
    includePreviousPeriod?: boolean;
    includeBaseline?: boolean;
  },
  periodLabel: string,
  chartHint: boolean,
): ToolResult {
  const metrics = request.metrics;
  if (outcome.ok) {
    const parsed = parseAppleHealthReadResultV1(outcome.result, { requestedMetrics: metrics });
    if (!parsed.ok) {
      return invalidHealthResult(metrics, periodLabel);
    }
    if (parsed.value.records.length === 0) {
      return invalidHealthResult(metrics, periodLabel);
    }
    const requestedDates = healthRequestedLocalDates(
      request.range,
      request.includePreviousPeriod === true,
      parsed.value.timeZone,
      new Date(parsed.value.generatedAt),
    );
    const outOfWindow = parsed.value.records.some(
      (record) => !requestedDates.includes(record.localDate),
    );
    if (outOfWindow || !healthResultWindowMatchesRequest(parsed.value, requestedDates)) {
      return invalidHealthResult(metrics, periodLabel);
    }
    if (!healthTimestampsValid(parsed.value, outcome.completedAt)) {
      return invalidHealthResult(metrics, periodLabel);
    }
    if (request.includeBaseline !== true && parsed.value.baselines !== undefined) {
      return invalidHealthResult(metrics, periodLabel);
    }
    return successResult(parsed.value, metrics, periodLabel, chartHint);
  }
  switch (outcome.reason) {
    case 'permission-denied':
      return {
        ok: false,
        code: 'permission-denied',
        message: 'Apple Health access was denied',
        details: {
          reason: outcome.reason,
          sensitivity: 'health',
          health: healthCard('denied', metrics, periodLabel),
        },
      };
    case 'cancelled':
      return {
        ok: false,
        code: 'aborted',
        message: 'Apple Health read was cancelled',
        cancelled: true,
        details: {
          reason: outcome.reason,
          sensitivity: 'health',
          health: healthCard('cancelled', metrics, periodLabel),
        },
      };
    case 'client-device-unavailable':
    case 'client-device-disconnected':
      return {
        ok: false,
        code: 'tool-not-available',
        message: unavailableMessage(outcome.reason),
        retryable: true,
        details: {
          reason: outcome.reason,
          sensitivity: 'health',
          health: healthCard('phone-offline', metrics, periodLabel),
        },
      };
    case 'user-presence-required':
    case 'client-tool-timeout':
      return {
        ok: false,
        code: 'tool-not-available',
        message: unavailableMessage(outcome.reason),
        retryable: true,
        details: {
          reason: outcome.reason,
          sensitivity: 'health',
          health: healthCard(
            outcome.reason === 'client-tool-timeout' ? 'timed-out' : 'waiting-for-phone',
            metrics,
            periodLabel,
          ),
        },
      };
    case 'no-accessible-data':
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'No authorized Apple Health data was available',
        retryable: false,
        details: {
          reason: outcome.reason,
          sensitivity: 'health',
          health: healthCard('no-data', metrics, periodLabel),
        },
      };
    case 'invalid-client-result':
    case 'client-tool-failed':
      return {
        ok: false,
        code: 'execution-failed',
        message: 'Apple Health read failed',
        retryable: false,
        details: {
          reason: outcome.reason,
          sensitivity: 'health',
          health: healthCard('failed', metrics, periodLabel),
        },
      };
  }
}

function invalidHealthResult(
  metrics: readonly AppleHealthMetricId[],
  periodLabel: string,
): ToolResult {
  return {
    ok: false,
    code: 'execution-failed',
    message: 'Apple Health result failed Host validation',
    details: {
      reason: 'invalid-client-result',
      sensitivity: 'health',
      health: healthCard('failed', metrics, periodLabel),
    },
  };
}

function healthTimestampsValid(
  result: AppleHealthReadResultV1,
  completedAt: string,
): boolean {
  const completedAtMs = Date.parse(completedAt);
  if (!Number.isFinite(completedAtMs)) {
    return false;
  }
  const window = {
    issuedAtMs: completedAtMs - CLIENT_TOOL_DEFAULT_DEADLINE_MS,
    deadlineAtMs: completedAtMs,
  };
  if (!isClientToolTimestampWithinSkew({ timestamp: result.generatedAt, ...window })) {
    return false;
  }
  const futureLimit = window.deadlineAtMs + CLIENT_TOOL_CLOCK_SKEW_MS;
  return result.records.every((record) => {
    const freshAsOfMs = Date.parse(record.freshAsOf);
    return Number.isFinite(freshAsOfMs) && freshAsOfMs <= futureLimit;
  });
}

function healthCard(
  status: HealthToolCardStatus,
  metrics: readonly AppleHealthMetricId[],
  periodLabel: string,
): HealthToolCardSummary {
  return {
    metrics: [...metrics],
    periodLabel,
    status,
  };
}

function successResult(
  result: AppleHealthReadResultV1,
  metrics: readonly AppleHealthMetricId[],
  periodLabel: string,
  chartHint: boolean,
): ToolResult {
  const partial = result.warnings.includes('partial-result') || result.unavailableMetrics.length > 0;
  const health: HealthToolCardSummary = {
    metrics: [...metrics],
    periodLabel,
    status: partial ? 'partial' : 'completed',
    timezone: result.timeZone,
    unavailableMetrics: result.unavailableMetrics.map((item) => item.metric),
    warnings: result.warnings,
  };
  const freshness = result.records[0]?.freshAsOf;
  if (freshness !== undefined) {
    health.freshnessLabel = freshness;
  }
  return {
    ok: true,
    output:
      chartHint && hasDailyTrend(result)
        ? `${formatHealthModelOutput(result)}\n${HEALTH_CHART_HINT}`
        : formatHealthModelOutput(result),
    details: {
      sensitivity: 'health',
      health,
    },
  };
}

export function formatHealthModelOutput(result: AppleHealthReadResultV1): string {
  const lines = [
    HEALTH_MODEL_OUTPUT_PREAMBLE,
    `source=${result.source}`,
    `timezone=${result.timeZone}`,
    `period=${result.startAt}/${result.endAt}`,
    `generatedAt=${result.generatedAt}`,
  ];
  for (const record of result.records) {
    const value = record.value === undefined ? 'unknown' : String(record.value);
    const when =
      record.localHour === undefined
        ? record.localDate
        : `${record.localDate}T${String(record.localHour).padStart(2, '0')}`;
    lines.push(
      `${record.metric} ${when} ${value} ${record.unit} freshAsOf=${record.freshAsOf}${formatComponents(record)}`,
    );
  }
  for (const baseline of result.baselines ?? []) {
    lines.push(formatBaselineLine(baseline));
  }
  for (const missing of result.unavailableMetrics) {
    lines.push(`${missing.metric} unavailable reason=${missing.reason}`);
  }
  if (result.warnings.length > 0) {
    lines.push(`warnings=${result.warnings.join(',')}`);
  }
  if (result.warnings.includes('host-cache')) {
    lines.push(HOST_CACHE_NOTICE);
  }
  return lines.join('\n');
}

function formatComponents(record: AppleHealthRecord): string {
  if (record.components === undefined) {
    return '';
  }
  if (record.metric !== 'sleep-schedule') {
    return ` components=${JSON.stringify(record.components)}`;
  }
  const bedtime = record.components[SLEEP_SCHEDULE_BEDTIME_COMPONENT];
  const wake = record.components[SLEEP_SCHEDULE_WAKE_COMPONENT];
  return (
    (bedtime === undefined ? '' : ` bedtime=${formatBedtime(bedtime)}`) +
    (wake === undefined ? '' : ` wake=${formatClock(wake)}`)
  );
}

function formatBaselineLine(baseline: AppleHealthBaseline): string {
  const format = baselineValueFormatter(baseline);
  const subject =
    baseline.component === undefined ? baseline.metric : `${baseline.metric}.${baseline.component}`;
  const parts = [
    `baseline ${subject} ${baseline.startDate}/${baseline.endDateExclusive}`,
    `days=${baseline.sampleDays}`,
    `mean=${format(baseline.mean)}`,
    // A spread is a duration even when the baseline itself is a clock time.
    `sd=${baseline.stdDev}`,
    `min=${format(baseline.min)}`,
    `max=${format(baseline.max)}`,
    `unit=${baseline.unit}`,
  ];
  const latest = baseline.latest;
  if (latest !== undefined) {
    parts.push(`latest=${latest.localDate}:${format(latest.value)}`);
    // A percent of a clock time means nothing; the z-score still does.
    if (latest.deltaPercent !== undefined && baseline.component === undefined) {
      parts.push(`delta=${latest.deltaPercent}%`);
    }
    if (latest.zScore !== undefined) {
      parts.push(`z=${latest.zScore}`);
    }
    if (latest.partialDay === true) {
      parts.push('partial-day');
    }
  }
  return parts.join(' ');
}

function baselineValueFormatter(baseline: AppleHealthBaseline): (value: number) => string {
  if (baseline.component === SLEEP_SCHEDULE_BEDTIME_COMPONENT) {
    return formatBedtime;
  }
  if (baseline.component === SLEEP_SCHEDULE_WAKE_COMPONENT) {
    return formatClock;
  }
  return String;
}

/** Bedtime is stored as minutes after noon of the previous day. */
function formatBedtime(minutesAfterNoon: number): string {
  return formatClock(minutesAfterNoon + 720);
}

function formatClock(minuteOfDay: number): string {
  const wrapped = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const minutes = String(wrapped % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function hasDailyTrend(result: AppleHealthReadResultV1): boolean {
  const days = new Set<string>();
  for (const record of result.records) {
    if (record.localHour === undefined) {
      days.add(record.localDate);
    }
  }
  return days.size >= CHART_HINT_MIN_DAILY_POINTS;
}

function formatPeriodLabel(range: {
  preset: string;
  startDate?: string;
  endDateExclusive?: string;
}): string {
  if (range.preset === 'today') return '今天';
  if (range.preset === 'last-7-days') return '近 7 天';
  if (range.preset === 'last-30-days') return '近 30 天';
  if (range.preset === 'custom' && range.startDate !== undefined && range.endDateExclusive !== undefined) {
    return `${range.startDate}–${range.endDateExclusive}`;
  }
  return '选定范围';
}

function unavailableMessage(reason: string): string {
  switch (reason) {
    case 'client-tool-timeout':
      return 'Timed out waiting for the iPhone';
    case 'user-presence-required':
      return 'Open Piwin on the iPhone to continue';
    default:
      return 'The paired iPhone is unavailable';
  }
}
