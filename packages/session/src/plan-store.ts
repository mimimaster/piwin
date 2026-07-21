/**
 * Persist session plan artifacts under ~/.piwin/sessions/<id>/plan.json.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionPlan } from '@piwin/contracts';
import { validateSessionPlan } from './validate-plan.js';

export async function loadSessionPlan(filePath: string): Promise<SessionPlan | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return null;
    const result = validateSessionPlan(JSON.parse(raw));
    return result.ok ? result.plan : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function saveSessionPlan(filePath: string, plan: SessionPlan): Promise<void> {
  const validated = validateSessionPlan(plan);
  if (!validated.ok) {
    throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(validated.plan, null, 2) + '\n', 'utf8');
}

export async function clearSessionPlan(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isNotFound(error)) return;
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
