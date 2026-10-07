/**
 * Host-side store of the daily Apple Health summaries paired phones upload.
 * One bounded, encrypted snapshot — small enough to rewrite atomically, so no
 * database is involved.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AppleHealthMetricId,
  AppleHealthRecord,
  HealthSummaryDeviceStatus,
  HealthSummarySyncBatchV1,
  HealthSummarySyncResult,
} from '@piwin/contracts';
import { decryptHealthSnapshot, encryptHealthSnapshot } from './summary-store-crypto.js';

export const HEALTH_SUMMARY_MAX_DEVICES = 4;
export const HEALTH_SUMMARY_MAX_STORED_RECORDS = 25_000;

type StoredDay = {
  record: AppleHealthRecord;
  /** `generatedAt` of the batch that wrote this day. */
  syncedAt: string;
};

type StoredDevice = {
  timeZone: string;
  lastSyncAt: string;
  /** Keyed by `metric:localDate`. */
  days: Record<string, StoredDay>;
};

type Snapshot = {
  version: 1;
  devices: Record<string, StoredDevice>;
};

export type HealthSummaryStoreOptions = {
  filePath: string;
  /** Resolved lazily so a Host that never stores health data never creates a key. */
  loadKey: () => Promise<Buffer>;
};

export type HealthSummaryReadInput = {
  metrics: readonly AppleHealthMetricId[];
  startDate: string;
  endDateExclusive: string;
};

export type HealthSummaryReadResult = {
  records: AppleHealthRecord[];
  /** Time zone and sync time of the device that synced last; absent when nothing is stored. */
  timeZone?: string;
  lastSyncAt?: string;
};

export class HealthSummaryStore {
  private readonly filePath: string;
  private readonly loadKey: () => Promise<Buffer>;
  private snapshot: Snapshot | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(options: HealthSummaryStoreOptions) {
    this.filePath = options.filePath;
    this.loadKey = options.loadKey;
  }

  public applyBatch(
    deviceId: string,
    batch: HealthSummarySyncBatchV1,
  ): Promise<HealthSummarySyncResult> {
    return this.exclusive(async () => {
      const snapshot = await this.load();
      let device = snapshot.devices[deviceId];
      if (device === undefined) {
        evictOldestDevice(snapshot);
        device = { timeZone: batch.timeZone, lastSyncAt: batch.generatedAt, days: {} };
        snapshot.devices[deviceId] = device;
      }
      const incoming = new Map<string, AppleHealthRecord>();
      for (const record of batch.records) {
        incoming.set(dayKey(record.metric, record.localDate), record);
      }
      let applied = false;
      for (const metric of batch.metrics) {
        for (const localDate of localDates(batch.startDate, batch.endDateExclusive)) {
          const key = dayKey(metric, localDate);
          const existing = device.days[key];
          // A delayed older upload must not undo a newer recompute of the same day.
          if (existing !== undefined && existing.syncedAt > batch.generatedAt) {
            continue;
          }
          const record = incoming.get(key);
          if (record === undefined) {
            if (existing !== undefined) {
              delete device.days[key];
              applied = true;
            }
            continue;
          }
          device.days[key] = { record, syncedAt: batch.generatedAt };
          applied = true;
        }
      }
      if (batch.generatedAt >= device.lastSyncAt) {
        device.lastSyncAt = batch.generatedAt;
        device.timeZone = batch.timeZone;
      }
      trimToRecordCap(snapshot);
      await this.persist(snapshot);
      return { applied, storedRecords: Object.keys(device.days).length };
    });
  }

  /** Daily records for the window, one per metric and day, newest sync winning across devices. */
  public read(input: HealthSummaryReadInput): Promise<HealthSummaryReadResult> {
    return this.exclusive(async () => {
      const snapshot = await this.load();
      const wanted = new Set<string>(input.metrics);
      const best = new Map<string, StoredDay>();
      let latest: StoredDevice | undefined;
      for (const device of Object.values(snapshot.devices)) {
        if (latest === undefined || device.lastSyncAt > latest.lastSyncAt) {
          latest = device;
        }
        for (const [key, day] of Object.entries(device.days)) {
          const { metric, localDate } = day.record;
          if (
            !wanted.has(metric) ||
            localDate < input.startDate ||
            localDate >= input.endDateExclusive
          ) {
            continue;
          }
          const current = best.get(key);
          if (current === undefined || day.syncedAt > current.syncedAt) {
            best.set(key, day);
          }
        }
      }
      const records = [...best.values()]
        .map((day) => day.record)
        .sort(
          (left, right) =>
            left.localDate.localeCompare(right.localDate) || left.metric.localeCompare(right.metric),
        );
      return latest === undefined
        ? { records }
        : { records, timeZone: latest.timeZone, lastSyncAt: latest.lastSyncAt };
    });
  }

  public status(): Promise<HealthSummaryDeviceStatus[]> {
    return this.exclusive(async () => {
      const snapshot = await this.load();
      return Object.entries(snapshot.devices).map(([deviceId, device]) => {
        const dates = Object.values(device.days)
          .map((day) => day.record.localDate)
          .sort();
        const status: HealthSummaryDeviceStatus = {
          deviceId,
          lastSyncAt: device.lastSyncAt,
          timeZone: device.timeZone,
          recordCount: dates.length,
        };
        const oldest = dates[0];
        const newest = dates[dates.length - 1];
        if (oldest !== undefined && newest !== undefined) {
          status.oldestLocalDate = oldest;
          status.newestLocalDate = newest;
        }
        return status;
      });
    });
  }

  public deleteDevice(deviceId: string): Promise<void> {
    return this.exclusive(async () => {
      const snapshot = await this.load();
      if (snapshot.devices[deviceId] === undefined) {
        return;
      }
      delete snapshot.devices[deviceId];
      await this.persist(snapshot);
    });
  }

  /** Remove the snapshot file itself; the delete is durable before this resolves. */
  public deleteAll(): Promise<void> {
    return this.exclusive(async () => {
      this.snapshot = { version: 1, devices: {} };
      await rm(this.filePath, { force: true });
    });
  }

  /** Drop days older than the retention window, counted back from `todayLocalDate`. */
  public prune(retentionDays: number, todayLocalDate: string): Promise<void> {
    return this.exclusive(async () => {
      const snapshot = await this.load();
      const cutoff = addDays(todayLocalDate, -retentionDays);
      let changed = false;
      for (const device of Object.values(snapshot.devices)) {
        for (const [key, day] of Object.entries(device.days)) {
          if (day.record.localDate < cutoff) {
            delete device.days[key];
            changed = true;
          }
        }
      }
      if (changed) {
        await this.persist(snapshot);
      }
    });
  }

  private async load(): Promise<Snapshot> {
    if (this.snapshot !== undefined) {
      return this.snapshot;
    }
    let serialized: string;
    try {
      serialized = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      this.snapshot = { version: 1, devices: {} };
      return this.snapshot;
    }
    // No plaintext fallback: a snapshot that cannot be decrypted is an error.
    const parsed = JSON.parse(decryptHealthSnapshot(serialized, await this.loadKey())) as Snapshot;
    this.snapshot = { version: 1, devices: parsed.devices ?? {} };
    return this.snapshot;
  }

  private async persist(snapshot: Snapshot): Promise<void> {
    const key = await this.loadKey();
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, encryptHealthSnapshot(JSON.stringify(snapshot), key), {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function dayKey(metric: string, localDate: string): string {
  return `${metric}:${localDate}`;
}

function localDates(startDate: string, endDateExclusive: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date < endDateExclusive; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function addDays(localDate: string, days: number): string {
  const next = new Date(Date.parse(`${localDate}T00:00:00Z`) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

function evictOldestDevice(snapshot: Snapshot): void {
  const entries = Object.entries(snapshot.devices);
  if (entries.length < HEALTH_SUMMARY_MAX_DEVICES) {
    return;
  }
  entries.sort(([, left], [, right]) => left.lastSyncAt.localeCompare(right.lastSyncAt));
  const oldest = entries[0];
  if (oldest !== undefined) {
    delete snapshot.devices[oldest[0]];
  }
}

function trimToRecordCap(snapshot: Snapshot): void {
  const all: Array<{ device: StoredDevice; key: string; localDate: string }> = [];
  for (const device of Object.values(snapshot.devices)) {
    for (const [key, day] of Object.entries(device.days)) {
      all.push({ device, key, localDate: day.record.localDate });
    }
  }
  if (all.length <= HEALTH_SUMMARY_MAX_STORED_RECORDS) {
    return;
  }
  all.sort((left, right) => left.localDate.localeCompare(right.localDate));
  for (const entry of all.slice(0, all.length - HEALTH_SUMMARY_MAX_STORED_RECORDS)) {
    delete entry.device.days[entry.key];
  }
}
