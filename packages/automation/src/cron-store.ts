import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CronJob, CronJobDocument } from '@piwin/contracts';

function emptyDoc(): CronJobDocument {
  return { version: 1, jobs: [] };
}

export function getCronStorePath(piwinRoot: string): string {
  return join(piwinRoot, 'automation', 'cron.json');
}

export async function loadCronJobs(filePath: string): Promise<CronJobDocument> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return emptyDoc();
    const parsed = JSON.parse(raw) as CronJobDocument;
    if (!parsed || !Array.isArray(parsed.jobs)) return emptyDoc();
    return { version: 1, jobs: parsed.jobs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDoc();
    throw error;
  }
}

export async function saveCronJobs(filePath: string, document: CronJobDocument): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

export async function upsertCronJob(filePath: string, job: CronJob): Promise<CronJob> {
  const document = await loadCronJobs(filePath);
  const index = document.jobs.findIndex((item) => item.id === job.id);
  if (index === -1) document.jobs.push(job);
  else document.jobs[index] = job;
  await saveCronJobs(filePath, document);
  return job;
}

export async function deleteCronJob(filePath: string, jobId: string): Promise<boolean> {
  const document = await loadCronJobs(filePath);
  const next = document.jobs.filter((item) => item.id !== jobId);
  if (next.length === document.jobs.length) return false;
  await saveCronJobs(filePath, { version: 1, jobs: next });
  return true;
}

/** Minimal schedule parser: every:Nm | @hourly | @daily | standard 5-field ignored for MVP (manual run only). */
export function isCronDue(job: CronJob, now: Date, lastRunAt?: string): boolean {
  if (!job.enabled) return false;
  const schedule = job.schedule.trim();
  if (schedule.startsWith('every:')) {
    const match = /^every:(\d+)([smh])$/.exec(schedule);
    if (!match) return false;
    const amount = Number(match[1]);
    const unit = match[2];
    const ms =
      unit === 's' ? amount * 1000 : unit === 'm' ? amount * 60_000 : amount * 3_600_000;
    if (!lastRunAt && !job.lastRunAt) return true;
    const last = Date.parse(lastRunAt ?? job.lastRunAt ?? '');
    if (!Number.isFinite(last)) return true;
    return now.getTime() - last >= ms;
  }
  if (schedule === '@hourly') {
    if (!job.lastRunAt) return true;
    const last = Date.parse(job.lastRunAt);
    return Number.isFinite(last) ? now.getTime() - last >= 3_600_000 : true;
  }
  if (schedule === '@daily') {
    if (!job.lastRunAt) return true;
    const last = Date.parse(job.lastRunAt);
    return Number.isFinite(last) ? now.getTime() - last >= 86_400_000 : true;
  }
  // Unknown cron expressions: never auto-fire (use cron/run).
  return false;
}
