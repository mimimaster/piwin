import { createHash, randomBytes } from 'node:crypto';
import type {
  SessionColdStorageConfig,
  SessionColdStoragePlan,
  SessionColdStoragePlanTarget,
  SessionColdStorageSkippedSession,
  SessionIndexRecord,
} from '@piwin/contracts';
import { COLD_STORAGE_PLAN_TTL_MS } from '@piwin/contracts';
import { evaluateColdStorageEligibility } from './session-cold-storage-eligibility.js';
import { hashSessionPayload } from './session-pack.js';

export function createColdStoragePlanId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `cold-${stamp}-${randomBytes(4).toString('hex')}`;
}

export function createColdStorageConfirmationDigest(input: {
  planId: string;
  packOutputDir: string;
  targets: Array<{
    sessionId: string;
    transcriptSha256: string;
    mediaTreeSha256?: string;
  }>;
}): string {
  const payload = {
    action: 'offload',
    planId: input.planId,
    packOutputDir: input.packOutputDir,
    targets: input.targets.map((target) => ({
      sessionId: target.sessionId,
      transcriptSha256: target.transcriptSha256,
      mediaTreeSha256: target.mediaTreeSha256 ?? '',
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function buildSessionColdStoragePlan(input: {
  records: readonly SessionIndexRecord[];
  config: SessionColdStorageConfig;
  resolvePaths: (sessionId: string) => { transcriptPath: string; mediaDir: string };
  isLive: (sessionId: string) => boolean | Promise<boolean>;
  transcriptExists: (sessionId: string) => Promise<boolean>;
  explicitSessionIds?: string[];
  now?: Date;
}): Promise<SessionColdStoragePlan> {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + COLD_STORAGE_PLAN_TTL_MS).toISOString();
  const packOutputDir = input.config.packOutputDir?.trim() ?? '';
  const explicit = input.explicitSessionIds ? new Set(input.explicitSessionIds) : undefined;
  const targets: SessionColdStoragePlanTarget[] = [];
  const skipped: SessionColdStorageSkippedSession[] = [];

  const candidates = explicit
    ? input.records.filter((record) => explicit.has(record.id))
    : [...input.records];

  if (explicit) {
    for (const sessionId of explicit) {
      if (!input.records.some((record) => record.id === sessionId)) {
        skipped.push({ sessionId, reason: 'unknown' });
      }
    }
  }

  for (const record of candidates) {
    const live = await input.isLive(record.id);
    const transcriptExists = await input.transcriptExists(record.id);
    const eligibility = evaluateColdStorageEligibility({
      record,
      config: input.config,
      live,
      transcriptExists,
      now,
      ignoreAge: explicit !== undefined,
    });
    if (!eligibility.eligible) {
      skipped.push({ sessionId: record.id, reason: eligibility.reason });
      continue;
    }
    const paths = input.resolvePaths(record.id);
    const hashed = await hashSessionPayload(paths);
    const target: SessionColdStoragePlanTarget = {
      sessionId: record.id,
      estimatedPayloadBytes: hashed.payloadBytes,
      transcriptSha256: hashed.transcriptSha256,
    };
    if (record.name) target.name = record.name;
    if (record.archivedAt) target.archivedAt = record.archivedAt;
    if (hashed.mediaTreeSha256) target.mediaTreeSha256 = hashed.mediaTreeSha256;
    targets.push(target);
  }

  const planId = createColdStoragePlanId(now);
  const confirmationDigest = createColdStorageConfirmationDigest({
    planId,
    packOutputDir,
    targets,
  });
  const estimatedPeakBytes = targets.reduce(
    (sum, target) => sum + target.estimatedPayloadBytes * 4,
    0,
  );
  return {
    planId,
    confirmationDigest,
    generatedAt,
    expiresAt,
    action: 'offload',
    packOutputDir,
    estimatedPeakBytes,
    targets,
    skipped,
  };
}
