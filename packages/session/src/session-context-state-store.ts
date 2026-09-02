/**
 * Session context occupancy + per-request assistant usage persistence.
 * Additive tables on transcript.sqlite3. Occupancy is never derived from billing.
 */

import {
  CONTEXT_TELEMETRY_VERSION,
  createUnknownSessionContextSnapshot,
  parseAssistantUsageMeasurement,
  parseContextBoundary,
  parseSessionContextSnapshot,
  type AssistantUsageMeasurement,
  type ContextBoundary,
  type SessionContextSnapshot,
} from '@piwin/contracts';
import { rollback } from './sqlite-errors.js';
import { stableSerialize } from './stable-serialize.js';
import { withActivePath } from './transcript-store-path.js';
import type { SessionTranscriptStore, TranscriptStoreCore } from './transcript-store.js';

const CONTEXT_SCHEMA_VERSION = CONTEXT_TELEMETRY_VERSION;

type ContextStateRow = {
  session_id: string;
  schema_version: number;
  revision: number;
  context_version: number;
  context_boundary_json: string;
  snapshot_json: string;
};

type AssistantUsageRow = {
  measurement_id: string;
  session_id: string;
  run_id: string | null;
  runtime_generation_id: string | null;
  message_id: string;
  recorded_at: string;
  measurement_json: string;
};

export const SESSION_CONTEXT_STATE_DDL = `
    CREATE TABLE IF NOT EXISTS session_context_state (
      session_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      context_version INTEGER NOT NULL,
      context_boundary_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_usage_measurement (
      measurement_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT,
      runtime_generation_id TEXT,
      message_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      measurement_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_usage_message
      ON assistant_usage_measurement(message_id);
    CREATE INDEX IF NOT EXISTS idx_assistant_usage_run
      ON assistant_usage_measurement(run_id);
`;

export function createSessionContextStateOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  | 'readContextState'
  | 'replaceContextState'
  | 'invalidateContextState'
  | 'readLatestAssistantUsageForActivePath'
  | 'putAssistantUsageMeasurement'
> {
  const { db, options, ensureOpen } = core;
  reconcileCopiedContextState(core);

  return {
    async readContextState() {
      try {
        ensureOpen();
      } catch {
        return null;
      }
      const row = readRow(core);
      if (row === undefined) {
        return null;
      }
      const snapshot = snapshotFromRow(row);
      if (snapshot === null || snapshot.sessionId !== options.sessionId) {
        try {
          db.exec('BEGIN IMMEDIATE');
          const next = invalidateLocked(core, {
            reason: 'schema-or-session-mismatch',
            contextBoundary: activeLeafBoundary(core),
            updatedAt: new Date().toISOString(),
          });
          db.exec('COMMIT');
          return next;
        } catch {
          rollback(db);
          return null;
        }
      }
      return snapshot;
    },

    async replaceContextState(input) {
      try {
        ensureOpen();
        db.exec('BEGIN IMMEDIATE');
        const row = readRow(core);
        if (row !== undefined) {
          const currentBoundary = parseContextBoundary(JSON.parse(row.context_boundary_json) as unknown);
          if (
            row.context_version !== input.expectedContextVersion ||
            currentBoundary === null ||
            stableSerialize(currentBoundary) !== stableSerialize(input.expectedBoundary)
          ) {
            db.exec('ROLLBACK');
            return { ok: false, reason: 'cas-mismatch' };
          }
        }
        const nextRevision = (row?.revision ?? 0) + 1;
        const snapshot: SessionContextSnapshot = {
          ...input.snapshot,
          sessionId: options.sessionId,
          revision: nextRevision,
        };
        upsertSnapshot(core, snapshot);
        db.exec('COMMIT');
        return { ok: true, snapshot };
      } catch {
        rollback(db);
        return { ok: false, reason: 'unavailable' };
      }
    },

    async invalidateContextState(input) {
      try {
        ensureOpen();
        db.exec('BEGIN IMMEDIATE');
        const snapshot = invalidateLocked(core, input);
        db.exec('COMMIT');
        return snapshot;
      } catch {
        rollback(db);
        return createUnknownSessionContextSnapshot({
          sessionId: options.sessionId,
          revision: 1,
          contextVersion: 1,
          contextBoundary: input.contextBoundary,
          phase: 'unavailable',
          reason: input.reason,
          updatedAt: input.updatedAt,
        });
      }
    },

    async readLatestAssistantUsageForActivePath() {
      try {
        ensureOpen();
      } catch {
        return null;
      }
      const row = db
        .prepare(
          withActivePath(
            `SELECT measurement_json FROM assistant_usage_measurement
             JOIN active_path ON assistant_usage_measurement.message_id = active_path.id
             WHERE assistant_usage_measurement.session_id = ?
             ORDER BY assistant_usage_measurement.recorded_at DESC,
                      assistant_usage_measurement.measurement_id DESC
             LIMIT 1`,
          ),
        )
        .get(options.sessionId, options.sessionId) as Pick<AssistantUsageRow, 'measurement_json'> | undefined;
      if (row === undefined) {
        return null;
      }
      try {
        return parseAssistantUsageMeasurement(JSON.parse(row.measurement_json) as unknown);
      } catch {
        return null;
      }
    },

    async putAssistantUsageMeasurement(measurement) {
      ensureOpen();
      const parsed = parseAssistantUsageMeasurement(measurement);
      if (parsed === null) {
        throw new Error('assistant usage measurement is invalid');
      }
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO assistant_usage_measurement(
            measurement_id, session_id, run_id, runtime_generation_id,
            message_id, recorded_at, measurement_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.measurementId,
          options.sessionId,
          parsed.runId ?? null,
          parsed.runtimeGenerationId ?? null,
          parsed.messageId,
          parsed.recordedAt,
          JSON.stringify(parsed),
        );
      return result.changes === 0 ? 'duplicate' : 'inserted';
    },
  };
}

export async function readOrInsertUnknownContextState(
  store: Pick<SessionTranscriptStore, 'readContextState' | 'replaceContextState' | 'getActiveLeaf'>,
  input: { sessionId: string; reason: string; updatedAt: string },
): Promise<SessionContextSnapshot> {
  const existing = await store.readContextState();
  if (existing !== null) {
    return existing;
  }
  const leaf = await store.getActiveLeaf();
  const snapshot = createUnknownSessionContextSnapshot({
    sessionId: input.sessionId,
    revision: 1,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: leaf },
    phase: leaf === null ? 'empty' : 'idle',
    reason: input.reason,
    updatedAt: input.updatedAt,
  });
  const replaced = await store.replaceContextState({
    expectedContextVersion: snapshot.contextVersion,
    expectedBoundary: snapshot.contextBoundary,
    snapshot,
  });
  if (replaced.ok) {
    return replaced.snapshot;
  }
  if (replaced.reason === 'cas-mismatch') {
    const raced = await store.readContextState();
    if (raced !== null) {
      return raced;
    }
  }
  return createUnknownSessionContextSnapshot({
    sessionId: input.sessionId,
    revision: 1,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: leaf },
    phase: 'unavailable',
    reason: 'store-unavailable',
    updatedAt: input.updatedAt,
  });
}

export async function seedDerivedSessionContextState(input: {
  source: Pick<SessionTranscriptStore, 'readContextState'>;
  target: Pick<SessionTranscriptStore, 'replaceContextState' | 'getActiveLeaf'>;
  targetSessionId: string;
  updatedAt: string;
  /**
   * Durable compaction copied alongside the derived transcript. The source
   * snapshot predates this boundary in older stores, so callers pass it
   * explicitly when they have also copied the compaction record.
   */
  compactionBoundary?: string;
  /**
   * Transcript cloning can establish history evidence even when a legacy
   * source has no persisted context snapshot yet.
   */
  historyHasDisplayableResponse?: boolean;
}): Promise<SessionContextSnapshot | null> {
  const source = await input.source.readContextState();
  const leaf = await input.target.getActiveLeaf();
  const boundary: ContextBoundary = { activeLeafMessageId: leaf };
  if (source?.contextBoundary.model !== undefined) {
    boundary.model = source.contextBoundary.model;
  }
  if (source?.contextBoundary.capabilityFingerprint !== undefined) {
    boundary.capabilityFingerprint = source.contextBoundary.capabilityFingerprint;
  }
  if (source?.contextBoundary.seedFingerprint !== undefined) {
    boundary.seedFingerprint = source.contextBoundary.seedFingerprint;
  }
  if (input.compactionBoundary !== undefined) {
    boundary.compactionBoundary = input.compactionBoundary;
  }
  const snapshot = createUnknownSessionContextSnapshot({
    sessionId: input.targetSessionId,
    revision: 1,
    contextVersion: 1,
    contextBoundary: boundary,
    phase: leaf === null ? 'empty' : 'idle',
    reason: 'derived-session',
    updatedAt: input.updatedAt,
  });
  const historyHasDisplayableResponse =
    input.historyHasDisplayableResponse ??
    source?.responseEvidence.historyHasDisplayableResponse ??
    false;
  if (historyHasDisplayableResponse || input.compactionBoundary !== undefined) {
    snapshot.responseEvidence = {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: true,
    };
  }
  // Occupancy stays unknown(derived-session) until the target active path is measured.
  const replaced = await input.target.replaceContextState({
    expectedContextVersion: snapshot.contextVersion,
    expectedBoundary: snapshot.contextBoundary,
    snapshot,
  });
  return replaced.ok ? replaced.snapshot : snapshot;
}

function reconcileCopiedContextState(core: TranscriptStoreCore): void {
  const rows = core.db.prepare('SELECT * FROM session_context_state').all() as ContextStateRow[];
  if (rows.length === 0) {
    return;
  }
  const own = rows.find((row) => row.session_id === core.options.sessionId);
  if (own !== undefined && rows.length === 1 && own.schema_version === CONTEXT_SCHEMA_VERSION) {
    const snapshot = snapshotFromRow(own);
    if (snapshot !== null && snapshot.sessionId === core.options.sessionId) {
      return;
    }
  }
  try {
    core.db.exec('BEGIN IMMEDIATE');
    invalidateLocked(core, {
      reason: 'schema-or-session-mismatch',
      contextBoundary: activeLeafBoundary(core),
      updatedAt: new Date().toISOString(),
    });
    core.db.exec('COMMIT');
  } catch {
    rollback(core.db);
  }
}

function invalidateLocked(
  core: TranscriptStoreCore,
  input: {
    expectedContextVersion?: number;
    reason: string;
    contextBoundary: ContextBoundary;
    updatedAt: string;
  },
): SessionContextSnapshot {
  const row = readRow(core);
  if (
    input.expectedContextVersion !== undefined &&
    row !== undefined &&
    row.context_version !== input.expectedContextVersion
  ) {
    return (
      snapshotFromRow(row) ??
      createUnknownSessionContextSnapshot({
        sessionId: core.options.sessionId,
        revision: row.revision,
        contextVersion: row.context_version,
        contextBoundary: input.contextBoundary,
        phase: 'invalidated',
        reason: input.reason,
        updatedAt: input.updatedAt,
      })
    );
  }
  core.db.prepare('DELETE FROM session_context_state').run();
  const resetIdentity = input.reason === 'schema-or-session-mismatch';
  const snapshot = createUnknownSessionContextSnapshot({
    sessionId: core.options.sessionId,
    revision: resetIdentity ? 1 : (row?.revision ?? 0) + 1,
    contextVersion: resetIdentity ? 1 : (row?.context_version ?? 1),
    contextBoundary: input.contextBoundary,
    phase: 'invalidated',
    reason: input.reason,
    updatedAt: input.updatedAt,
  });
  upsertSnapshot(core, snapshot);
  return snapshot;
}

function upsertSnapshot(core: TranscriptStoreCore, snapshot: SessionContextSnapshot): void {
  core.db
    .prepare(
      `INSERT OR REPLACE INTO session_context_state(
        session_id, schema_version, revision, context_version,
        context_boundary_json, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      core.options.sessionId,
      CONTEXT_SCHEMA_VERSION,
      snapshot.revision,
      snapshot.contextVersion,
      JSON.stringify(snapshot.contextBoundary),
      JSON.stringify(snapshot),
    );
}

function readRow(core: TranscriptStoreCore): ContextStateRow | undefined {
  return core.db
    .prepare('SELECT * FROM session_context_state WHERE session_id = ?')
    .get(core.options.sessionId) as ContextStateRow | undefined;
}

function snapshotFromRow(row: ContextStateRow): SessionContextSnapshot | null {
  if (row.schema_version !== CONTEXT_SCHEMA_VERSION) {
    return null;
  }
  try {
    return parseSessionContextSnapshot(JSON.parse(row.snapshot_json) as unknown);
  } catch {
    return null;
  }
}

function activeLeafBoundary(core: TranscriptStoreCore): ContextBoundary {
  const row = core.db
    .prepare('SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?')
    .get(core.options.sessionId) as { active_leaf_message_id: string | null } | undefined;
  return { activeLeafMessageId: row?.active_leaf_message_id ?? null };
}
