import { createHash } from 'node:crypto';
import type {
  SessionArchivePolicy,
  SessionIndexRecord,
  SessionLifecycleArchiveCandidate,
  SessionLifecycleArchiveReason,
  SessionLifecyclePlan,
} from '@piwin/contracts';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function normalizeSessionArchivePolicy(
  policy: SessionArchivePolicy | undefined,
): SessionArchivePolicy {
  const normalized: SessionArchivePolicy = {};
  if (isPositiveInteger(policy?.maxInactiveDays)) {
    normalized.maxInactiveDays = policy.maxInactiveDays;
  }
  if (isNonNegativeInteger(policy?.maxActiveMainSessions)) {
    normalized.maxActiveMainSessions = policy.maxActiveMainSessions;
  }
  return normalized;
}

export function createSessionLifecyclePlan(input: {
  records: readonly SessionIndexRecord[];
  policy: SessionArchivePolicy | undefined;
  now?: Date;
}): SessionLifecyclePlan {
  const now = input.now ?? new Date();
  const policy = normalizeSessionArchivePolicy(input.policy);
  const activeMainRecords: SessionIndexRecord[] = [];
  let skippedPinned = 0;
  let skippedNonMain = 0;

  for (const record of input.records) {
    if (record.isArchived === true) {
      continue;
    }
    if (!isMainSession(record)) {
      skippedNonMain += 1;
      continue;
    }
    if (record.isPinned === true) {
      skippedPinned += 1;
      continue;
    }
    activeMainRecords.push(record);
  }

  const reasonBySessionId = new Map<string, SessionLifecycleArchiveReason>();
  if (policy.maxInactiveDays !== undefined) {
    const cutoffMilliseconds = now.getTime() - policy.maxInactiveDays * DAY_MILLISECONDS;
    for (const record of activeMainRecords) {
      const updatedMilliseconds = Date.parse(record.updatedAt);
      if (Number.isFinite(updatedMilliseconds) && updatedMilliseconds < cutoffMilliseconds) {
        reasonBySessionId.set(record.id, 'inactive-age');
      }
    }
  }

  if (policy.maxActiveMainSessions !== undefined) {
    const newestFirst = [...activeMainRecords].sort(compareNewestFirst);
    const recordsOverLimit = newestFirst.slice(policy.maxActiveMainSessions);
    for (const record of recordsOverLimit) {
      if (!reasonBySessionId.has(record.id)) {
        reasonBySessionId.set(record.id, 'active-limit');
      }
    }
  }

  const candidates: SessionLifecycleArchiveCandidate[] = activeMainRecords
    .filter((record) => reasonBySessionId.has(record.id))
    .sort(compareOldestFirst)
    .map((record) => ({
      sessionId: record.id,
      ...(record.name !== undefined ? { name: record.name } : {}),
      updatedAt: record.updatedAt,
      reason: reasonBySessionId.get(record.id) ?? 'active-limit',
    }));
  const generatedAt = now.toISOString();
  return {
    planId: calculateSessionLifecyclePlanId({ policy, candidates }),
    generatedAt,
    policy,
    candidates,
    skippedPinned,
    skippedNonMain,
  };
}

export function calculateSessionLifecyclePlanId(input: {
  policy: SessionArchivePolicy;
  candidates: readonly SessionLifecycleArchiveCandidate[];
}): string {
  const payload = JSON.stringify({
    policy: normalizeSessionArchivePolicy(input.policy),
    candidates: input.candidates.map((candidate) => ({
      sessionId: candidate.sessionId,
      updatedAt: candidate.updatedAt,
      reason: candidate.reason,
    })),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

export function sessionArchivePoliciesEqual(
  left: SessionArchivePolicy | undefined,
  right: SessionArchivePolicy | undefined,
): boolean {
  return (
    JSON.stringify(normalizeSessionArchivePolicy(left)) ===
    JSON.stringify(normalizeSessionArchivePolicy(right))
  );
}

function isMainSession(record: SessionIndexRecord): boolean {
  return record.kind === undefined || record.kind === 'main';
}

function compareNewestFirst(left: SessionIndexRecord, right: SessionIndexRecord): number {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : right.id.localeCompare(left.id);
}

function compareOldestFirst(left: SessionIndexRecord, right: SessionIndexRecord): number {
  const byUpdatedAt = left.updatedAt.localeCompare(right.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
