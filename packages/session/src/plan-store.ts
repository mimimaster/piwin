/**
 * Persist session plan artifacts under ~/.piwin/sessions/<id>/plan.json.
 *
 * Contract: every create/update/clear/heal/isolate for one path runs under a
 * per-path in-process and OS file lock. The storage layer assigns the
 * committed revision (`current.revision + 1`, or `0` on create). Mutators must
 * derive from the lock-held current document. `saveSessionPlan` is create-only.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import type {
  SessionPlan,
  SessionPlanVersion,
  SessionPlanWriteExpectation,
} from '@piwin/contracts';
import { validateSessionPlan } from './validate-plan.js';
import { writeTextFileAtomic } from './atomic-text-file.js';
import { extractLeadingJsonObject } from './plan-json.js';
import { withFileWriteLock } from './file-write-lock.js';

const INITIAL_PLAN_REVISION = 0;

export async function loadSessionPlan(filePath: string): Promise<SessionPlan | null> {
  const analysis = await analyzePlanDocument(filePath);
  if (analysis.kind === 'missing') return null;
  if (analysis.kind === 'valid') return analysis.plan;
  if (analysis.kind === 'io-error') {
    throw new PlanMutationError(`${analysis.code}: ${analysis.message}`);
  }
  return enqueuePlanOp(filePath, async () => {
    const inspection = await inspectPlanDocument(filePath);
    if (inspection.kind === 'io-error') {
      throw new PlanMutationError(`${inspection.code}: ${inspection.message}`);
    }
    if (inspection.kind === 'recovered') {
      await writePlanDocument(filePath, inspection.plan);
      return inspection.plan;
    }
    return inspection.kind === 'valid' ? inspection.plan : null;
  });
}

export class PlanMutationError extends Error {
  readonly name = 'PlanMutationError';
  constructor(message: string) {
    super(message);
  }
}

export class PlanRevisionConflictError extends Error {
  readonly name = 'PlanRevisionConflictError';
  constructor(message: string) {
    super(message);
  }
}

export class PlanAlreadyExistsError extends Error {
  readonly name = 'PlanAlreadyExistsError';
  constructor(message: string) {
    super(message);
  }
}

export type SessionPlanInspection =
  | { kind: 'missing' }
  | { kind: 'valid'; plan: SessionPlan }
  | { kind: 'recovered'; plan: SessionPlan; backupPath: string }
  | { kind: 'corrupt'; backupPath: string }
  | { kind: 'io-error'; code: string; message: string };

type PlanDocumentAnalysis =
  | { kind: 'missing' }
  | { kind: 'valid'; plan: SessionPlan }
  | { kind: 'recovered'; plan: SessionPlan }
  | { kind: 'corrupt' }
  | { kind: 'io-error'; code: string; message: string };

export async function inspectSessionPlan(filePath: string): Promise<SessionPlanInspection> {
  return enqueuePlanOp(filePath, async () => {
    const inspection = await inspectPlanDocument(filePath);
    if (inspection.kind === 'recovered') {
      await writePlanDocument(filePath, inspection.plan);
    }
    return inspection;
  });
}

function enqueuePlanOp<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  return withFileWriteLock(resolvePath(filePath), operation).catch((error: unknown) => {
    if (isPlanStoreError(error)) {
      throw error;
    }
    throw new PlanMutationError(formatPlanOperationError('plan operation failed', error));
  });
}

/**
 * Lock-held mutation. Mutator must derive from `current`. Returning null is a
 * no-op (revision unchanged). The store assigns the committed revision.
 */
export async function updateSessionPlan(
  filePath: string,
  mutator: (current: SessionPlan | null) => SessionPlan | null,
  expected?: SessionPlanWriteExpectation,
): Promise<SessionPlan | null> {
  return enqueuePlanOp(filePath, async () => {
    const inspection = await inspectPlanDocument(filePath);
    if (inspection.kind === 'io-error') {
      throw new PlanMutationError(`${inspection.code}: ${inspection.message}`);
    }
    if (inspection.kind === 'corrupt') {
      throw new PlanMutationError(`plan file is corrupt (${inspection.backupPath})`);
    }
    const current =
      inspection.kind === 'valid' || inspection.kind === 'recovered' ? inspection.plan : null;
    if (inspection.kind === 'recovered') {
      await writePlanDocument(filePath, inspection.plan);
    }
    assertExpectedPlan(current, expected);
    const next = mutator(current);
    if (next === null) {
      return current;
    }
    const committed = assignCommittedRevision(current, next);
    await writePlanDocument(filePath, committed);
    return committed;
  });
}

export async function saveSessionPlan(filePath: string, plan: SessionPlan): Promise<void> {
  const created = await updateSessionPlan(filePath, (current) => {
    if (current !== null) {
      throw new PlanAlreadyExistsError(
        `plan already exists at revision ${current.revision}; use updateSessionPlan`,
      );
    }
    return plan;
  });
  if (created === null) {
    throw new PlanMutationError('create-only save produced no plan');
  }
}

export async function clearSessionPlan(
  filePath: string,
  expected?: SessionPlanVersion,
): Promise<void> {
  await enqueuePlanOp(filePath, async () => {
    const inspection = await inspectPlanDocument(filePath);
    if (inspection.kind === 'io-error') {
      throw new PlanMutationError(`${inspection.code}: ${inspection.message}`);
    }
    if (inspection.kind === 'corrupt') {
      throw new PlanMutationError(`plan file is corrupt (${inspection.backupPath})`);
    }
    const current =
      inspection.kind === 'valid' || inspection.kind === 'recovered' ? inspection.plan : null;
    if (inspection.kind === 'recovered') {
      await writePlanDocument(filePath, inspection.plan);
    }
    assertExpectedPlan(current, expected);
    if (current === null) return;
    try {
      await unlink(resolvePath(filePath));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  });
}

async function writePlanDocument(filePath: string, plan: SessionPlan): Promise<void> {
  const validated = validateSessionPlan(plan);
  if (!validated.ok) {
    throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  const absolutePath = resolvePath(filePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeTextFileAtomic(absolutePath, `${JSON.stringify(validated.plan, null, 2)}\n`);
}

function assignCommittedRevision(current: SessionPlan | null, next: SessionPlan): SessionPlan {
  const revision = current === null ? INITIAL_PLAN_REVISION : current.revision + 1;
  return {
    ...next,
    revision,
    updatedAt: new Date().toISOString(),
  };
}

function assertExpectedPlan(
  current: SessionPlan | null,
  expected: SessionPlanWriteExpectation | undefined,
): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (current !== null) {
      throw new PlanAlreadyExistsError(
        `plan already exists at revision ${current.revision}; create expected an absent plan`,
      );
    }
    return;
  }
  if (current === null) {
    throw new PlanRevisionConflictError(
      `plan missing: expected ${expected.planId} at revision ${expected.revision}`,
    );
  }
  if (current.id !== expected.planId) {
    throw new PlanRevisionConflictError(
      `plan id mismatch: expected ${expected.planId} but session has ${current.id}`,
    );
  }
  if (current.revision !== expected.revision) {
    throw new PlanRevisionConflictError(
      `plan revision mismatch: expected ${expected.revision} but session has ${current.revision}`,
    );
  }
}

async function inspectPlanDocument(
  filePath: string,
): Promise<SessionPlanInspection> {
  const analysis = await analyzePlanDocument(filePath);
  if (analysis.kind === 'missing' || analysis.kind === 'valid' || analysis.kind === 'io-error') {
    return analysis;
  }
  if (analysis.kind === 'corrupt') {
    const backupPath = await isolateCorruptPlanFile(resolvePath(filePath));
    return backupPath === undefined
      ? { kind: 'missing' }
      : { kind: 'corrupt', backupPath };
  }
  const backupPath = await copyOriginalPlanBytes(resolvePath(filePath));
  if (backupPath === undefined) {
    return { kind: 'valid', plan: analysis.plan };
  }
  return { kind: 'recovered', plan: analysis.plan, backupPath };
}

async function analyzePlanDocument(
  filePath: string,
): Promise<PlanDocumentAnalysis> {
  const absolutePath = resolvePath(filePath);
  try {
    const raw = await readFile(absolutePath, 'utf8');
    if (!raw.trim()) {
      return { kind: 'corrupt' };
    }
    const extracted = extractLeadingJsonObject(raw);
    if (extracted === undefined) {
      return { kind: 'corrupt' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.json);
    } catch {
      return { kind: 'corrupt' };
    }
    const result = validateSessionPlan(parsed);
    if (!result.ok) {
      return { kind: 'corrupt' };
    }
    if (!extracted.trailingGarbage) {
      return { kind: 'valid', plan: result.plan };
    }
    return { kind: 'recovered', plan: result.plan };
  } catch (error) {
    if (isNotFound(error)) {
      return { kind: 'missing' };
    }
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'io-error', code, message };
  }
}

async function isolateCorruptPlanFile(filePath: string): Promise<string | undefined> {
  const backupPath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
  try {
    await rename(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function copyOriginalPlanBytes(filePath: string): Promise<string | undefined> {
  const backupPath = `${filePath}.recovered-${Date.now()}-${randomUUID()}`;
  try {
    await copyFile(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}

function isPlanStoreError(error: unknown): boolean {
  return (
    error instanceof PlanMutationError ||
    error instanceof PlanRevisionConflictError ||
    error instanceof PlanAlreadyExistsError
  );
}

function formatPlanOperationError(operation: string, error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? `${error.code}: `
      : '';
  const message = error instanceof Error ? error.message : String(error);
  return `${code}${operation}: ${message}`;
}
