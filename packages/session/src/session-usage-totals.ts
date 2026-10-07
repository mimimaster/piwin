/**
 * Per-session cumulative usage for the composer stats line. Reads the session's
 * own `assistant_usage_measurement` rows (every finalized request, all
 * branches) instead of scanning the global ledger file.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  parseAssistantUsageMeasurement,
  type SessionLatestRequestTiming,
  type SessionUsageTotals,
} from '@piwin/contracts';
import { withActivePath } from './transcript-store-path.js';
import { addToUsageBucket, createUsageBucket } from './usage-bucket.js';

export function readSessionUsageTotals(db: DatabaseSync, sessionId: string): SessionUsageTotals {
  const bucket = createUsageBucket();
  const rows = db
    .prepare(
      `SELECT measurement_json FROM assistant_usage_measurement
       WHERE session_id = ?
       ORDER BY recorded_at ASC, measurement_id ASC`,
    )
    .all(sessionId) as unknown as Array<{ measurement_json: string }>;
  // Rows are in recording order, so the last parsed one is the latest request.
  let latestRequest: SessionLatestRequestTiming | undefined;
  for (const row of rows) {
    let measurement;
    try {
      measurement = parseAssistantUsageMeasurement(JSON.parse(row.measurement_json) as unknown);
    } catch {
      continue;
    }
    if (measurement) {
      addToUsageBucket(bucket, {
        ...measurement,
        success: measurement.stopReason !== 'error' && measurement.stopReason !== 'aborted',
      });
      latestRequest = {
        messageId: measurement.messageId,
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
  return {
    ...bucket,
    sessionId,
    userTurnCount: turns?.count ?? 0,
    ...(latestRequest ? { latestRequest } : {}),
  };
}
