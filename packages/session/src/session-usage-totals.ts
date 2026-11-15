/**
 * Per-session cumulative usage for the composer stats line. Reads the session's
 * own `assistant_usage_measurement` rows (every finalized request, all
 * branches) instead of scanning the global ledger file.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  normalizeUsageTokenSplit,
  parseAssistantUsageMeasurement,
  type AssistantUsageMeasurement,
  type SessionLatestRequestTiming,
  type SessionUsageTotals,
} from '@piwin/contracts';
import { withActivePath } from './transcript-store-path.js';
import { addToUsageBucket, createUsageBucket } from './usage-bucket.js';

export type SessionMeasurementCostEstimator = (
  measurement: AssistantUsageMeasurement,
) => number | undefined;

export function summarizeMeasurementsIntoSessionTotals(
  sessionId: string,
  measurements: readonly AssistantUsageMeasurement[],
  userTurnCount: number,
  estimateCost?: SessionMeasurementCostEstimator,
): SessionUsageTotals {
  const bucket = createUsageBucket();
  let latestRequest: SessionLatestRequestTiming | undefined;
  for (const raw of measurements) {
    const measurement = normalizeUsageTokenSplit(raw);
    const estimatedUsd =
      estimateCost?.(measurement) ??
      (typeof measurement.costUsd === 'number' && Number.isFinite(measurement.costUsd) && measurement.costUsd >= 0
        ? measurement.costUsd
        : undefined);
    addToUsageBucket(
      bucket,
      {
        ...measurement,
        success: measurement.stopReason !== 'error' && measurement.stopReason !== 'aborted',
      },
      estimatedUsd,
    );
    latestRequest = {
      messageId: measurement.messageId,
      ...(measurement.promptTokens !== undefined ? { promptTokens: measurement.promptTokens } : {}),
      ...(measurement.cacheReadTokens !== undefined
        ? { cacheReadTokens: measurement.cacheReadTokens }
        : {}),
      ...(measurement.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: measurement.cacheWriteTokens }
        : {}),
      ...(measurement.completionTokens !== undefined
        ? { completionTokens: measurement.completionTokens }
        : {}),
      ...(measurement.durationMs !== undefined ? { durationMs: measurement.durationMs } : {}),
      ...(measurement.firstTokenMs !== undefined ? { firstTokenMs: measurement.firstTokenMs } : {}),
      ...(measurement.reasoningTokens !== undefined
        ? { reasoningTokens: measurement.reasoningTokens }
        : {}),
      ...(measurement.firstTokenKind !== undefined
        ? { firstTokenKind: measurement.firstTokenKind }
        : {}),
    };
  }
  return {
    ...bucket,
    sessionId,
    userTurnCount,
    ...(latestRequest ? { latestRequest } : {}),
  };
}

export function readSessionUsageTotals(
  db: DatabaseSync,
  sessionId: string,
  estimateCost?: SessionMeasurementCostEstimator,
): SessionUsageTotals {
  const rows = db
    .prepare(
      `SELECT measurement_json FROM assistant_usage_measurement
       WHERE session_id = ?
       ORDER BY recorded_at ASC, measurement_id ASC`,
    )
    .all(sessionId) as unknown as Array<{ measurement_json: string }>;
  // Rows are in recording order, so the last parsed one is the latest request.
  const measurements: AssistantUsageMeasurement[] = [];
  for (const row of rows) {
    try {
      const parsed = parseAssistantUsageMeasurement(JSON.parse(row.measurement_json) as unknown);
      if (parsed) measurements.push(parsed);
    } catch {
      continue;
    }
  }
  const turns = db
    .prepare(
      withActivePath(
        `SELECT COUNT(*) AS count FROM transcript_message
         JOIN active_path ON transcript_message.id = active_path.id
         WHERE role = 'user' AND length(trim(text)) > 0`,
      ),
    )
    .get(sessionId) as { count: number } | undefined;
  return summarizeMeasurementsIntoSessionTotals(
    sessionId,
    measurements,
    turns?.count ?? 0,
    estimateCost,
  );
}
