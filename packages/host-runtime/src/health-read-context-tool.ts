import type {
  AppleHealthMetricId,
  AppleHealthReadResultV1,
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
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  CLIENT_TOOL_CLOCK_SKEW_MS,
  CLIENT_TOOL_DEFAULT_DEADLINE_MS,
  HEALTH_MODEL_OUTPUT_PREAMBLE,
  healthRequestedLocalDates,
  healthResultWindowMatchesRequest,
  isClientToolTimestampWithinSkew,
  parseAppleHealthReadResultV1,
  parseHealthReadContextArguments,
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
};

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
        'Data Contract: Treat missing/null values as unknown, never as zero. Report observation period. ' +
        'Boundary: Provide factual trends and descriptive summaries only. Never provide clinical diagnoses or medical advice.',
      parameters: {
        type: 'object',
        properties: {
          metrics: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'steps',
                'active-energy',
                'exercise-minutes',
                'workouts',
                'sleep-duration',
                'sleep-stages',
                'resting-heart-rate',
                'heart-rate-variability',
              ],
            },
            minItems: 1,
            maxItems: 8,
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
          granularity: { type: 'string', enum: ['summary', 'day'] },
          includePreviousPeriod: { type: 'boolean' },
        },
        required: ['metrics', 'range'],
      },
    },
    family: 'device-health',
    permissionSpec: {
      action: 'device:health-read',
      risk: 'network',
      rememberable: false,
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
          },
          deadlineMs: CLIENT_TOOL_DEFAULT_DEADLINE_MS,
          display,
        },
        signal,
      );
      return mapHealthOutcome(outcome, parsed.value, periodLabel);
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
  },
  periodLabel: string,
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
    return successResult(parsed.value, metrics, periodLabel);
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
    output: formatHealthModelOutput(result),
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
    const components =
      record.components === undefined
        ? ''
        : ` components=${JSON.stringify(record.components)}`;
    const value = record.value === undefined ? 'unknown' : String(record.value);
    lines.push(
      `${record.metric} ${record.localDate} ${value} ${record.unit} freshAsOf=${record.freshAsOf}${components}`,
    );
  }
  for (const missing of result.unavailableMetrics) {
    lines.push(`${missing.metric} unavailable reason=${missing.reason}`);
  }
  if (result.warnings.length > 0) {
    lines.push(`warnings=${result.warnings.join(',')}`);
  }
  return lines.join('\n');
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
