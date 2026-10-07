import type { HealthDigestConfig } from '@piwin/contracts';

/**
 * Whether the scheduled digest should run now. It runs once per scheduled
 * slot, on the Host's own clock, and catches up the same day when the Host was
 * asleep at the scheduled minute — but never replays a slot from an earlier day.
 */
export function isHealthDigestDue(
  config: Pick<HealthDigestConfig, 'enabled' | 'cadence' | 'time' | 'weekday'>,
  now: Date,
  lastRunAt: string | undefined,
): boolean {
  if (!config.enabled) {
    return false;
  }
  if (config.cadence === 'weekly' && now.getDay() !== config.weekday) {
    return false;
  }
  const [hours, minutes] = config.time.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) {
    return false;
  }
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  if (now.getTime() < slot.getTime()) {
    return false;
  }
  const lastRun = lastRunAt === undefined ? Number.NaN : Date.parse(lastRunAt);
  return !Number.isFinite(lastRun) || lastRun < slot.getTime();
}
