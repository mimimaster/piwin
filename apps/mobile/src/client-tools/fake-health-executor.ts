import type { AppleHealthReadResultV1, ClientToolRequestFrame } from '@piwin/contracts';
import { parseHealthReadContextArguments } from '@piwin/contracts';

export const FAKE_HEALTH_STEPS = 1111;

/**
 * Deterministic Health executor for tests/dev only. Production builds must
 * never register this function.
 */
export async function executeFakeHealthRead(
  request: ClientToolRequestFrame,
  now: () => Date = () => new Date(),
): Promise<AppleHealthReadResultV1> {
  const parsed = parseHealthReadContextArguments(request.arguments);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const generatedAt = now().toISOString();
  const records = parsed.value.metrics.includes('steps')
    ? [
        {
          metric: 'steps' as const,
          localDate: generatedAt.slice(0, 10),
          unit: 'count' as const,
          value: FAKE_HEALTH_STEPS,
          freshAsOf: generatedAt,
        },
      ]
    : [];
  return {
    schemaVersion: 1,
    source: 'apple-health',
    timeZone: 'UTC',
    startAt: generatedAt,
    endAt: generatedAt,
    generatedAt,
    records,
    unavailableMetrics: parsed.value.metrics
      .filter((metric) => metric !== 'steps')
      .map((metric) => ({ metric, reason: 'not-authorized-or-no-data' as const })),
    warnings: records.length > 0 && parsed.value.metrics.length > 1 ? ['partial-result'] : [],
  };
}

export function isFakeHealthExecutorAllowed(input: {
  production: boolean;
  allowFake: boolean;
}): boolean {
  return input.production !== true && input.allowFake === true;
}
