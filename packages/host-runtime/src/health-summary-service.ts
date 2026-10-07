/**
 * Stored Apple Health summaries on the Host (ADR 0062 M2): the sync target for
 * paired phones, the offline answer for `health_read_context`, and the
 * scheduled digest. Everything here is off until the user enables it in
 * `config.health`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AppleHealthReadResultV1,
  ClientToolExecutionPort,
  HealthConfig,
  HealthDigestRunStatus,
  HealthReadContextArguments,
  HealthSummaryStatus,
  HealthSummarySyncBatchV1,
  HealthSummarySyncPort,
  HealthSummarySyncResult,
  HostCommand,
  HostResponse,
  PiwinConfig,
} from '@piwin/contracts';
import {
  APPLE_HEALTH_BASELINE_WINDOW_DAYS,
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  computeHealthBaselines,
  formatLocalDateInTimeZone,
  healthRequestedLocalDates,
  normalizeHealthConfig,
} from '@piwin/contracts';
import { HealthSummaryStore, isHealthDigestDue, loadOrCreateHealthStoreKey } from '@piwin/health';
import { buildHealthDigestPrompt, healthDigestSessionName } from './health-digest-prompt.js';

const DIGEST_TICK_MS = 60_000;
/** How long a due digest waits for the phone's first sync of the day. */
const DIGEST_SYNC_GRACE_MS = 3 * 60 * 60_000;
const DIGEST_DAILY_WINDOW_DAYS = 7;
const DIGEST_WEEKLY_WINDOW_DAYS = 14;

export class HealthSummaryStorageDisabledError extends Error {
  public constructor() {
    super('Health summary storage is turned off on this Host');
    this.name = 'HealthSummaryStorageDisabledError';
  }
}

export type HealthDigestOutcome = {
  ok: boolean;
  status: 'ok' | 'error' | 'skipped';
  message?: string;
  sessionId?: string;
};

export type HealthSummaryServiceOptions = {
  piwinRoot: string;
  loadConfig: () => Promise<PiwinConfig>;
  /** Runs a Host command through the normal dispatch path. */
  runCommand: (command: HostCommand) => Promise<HostResponse>;
  now?: () => Date;
  onError?: (error: Error) => void;
};

export class HealthSummaryService implements HealthSummarySyncPort {
  private readonly store: HealthSummaryStore;
  private readonly statePath: string;
  private readonly loadConfig: () => Promise<PiwinConfig>;
  private readonly runCommand: (command: HostCommand) => Promise<HostResponse>;
  private readonly now: () => Date;
  private readonly onError: (error: Error) => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  /** Sync so tool registration can ask without awaiting the encrypted store. */
  private storedSummariesAvailable = false;

  public constructor(options: HealthSummaryServiceOptions) {
    const directory = join(options.piwinRoot, 'health');
    this.store = new HealthSummaryStore({
      filePath: join(directory, 'summaries.v1.enc'),
      loadKey: () => loadOrCreateHealthStoreKey(join(directory, 'summaries.key')),
    });
    this.statePath = join(directory, 'digest-state.json');
    this.loadConfig = options.loadConfig;
    this.runCommand = options.runCommand;
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError ?? (() => undefined);
  }

  public start(): void {
    if (this.timer !== undefined) {
      return;
    }
    void this.refreshAvailability().catch((error: unknown) => this.report(error));
    this.timer = setInterval(() => void this.tick(), DIGEST_TICK_MS);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async isStorageEnabled(): Promise<boolean> {
    return (await this.healthConfig()).summaryStore.enabled;
  }

  public hasStoredSummaries(): boolean {
    return this.storedSummariesAvailable;
  }

  public async sync(
    deviceId: string,
    batch: HealthSummarySyncBatchV1,
  ): Promise<HealthSummarySyncResult> {
    const config = await this.healthConfig();
    if (!config.summaryStore.enabled) {
      throw new HealthSummaryStorageDisabledError();
    }
    const result = await this.store.applyBatch(deviceId, batch);
    await this.store.prune(
      config.summaryStore.retentionDays,
      formatLocalDateInTimeZone(this.now(), batch.timeZone),
    );
    this.storedSummariesAvailable = true;
    return result;
  }

  public async deleteDevice(deviceId: string): Promise<void> {
    await this.store.deleteDevice(deviceId);
    await this.refreshAvailability(true);
  }

  public async deleteAll(): Promise<void> {
    await this.store.deleteAll();
    this.storedSummariesAvailable = false;
  }

  public async status(): Promise<HealthSummaryStatus> {
    const config = await this.healthConfig();
    return {
      storageEnabled: config.summaryStore.enabled,
      devices: await this.store.status(),
      digest: { enabled: config.digest.enabled, ...(await this.readDigestState()) },
    };
  }

  /**
   * Lets the health tool exist when no phone is connected but summaries are
   * stored: the port then reports a capable "device" for Apple Health.
   */
  public wrapExecutionPort(port: ClientToolExecutionPort): ClientToolExecutionPort {
    return {
      execute: (request, signal) => port.execute(request, signal),
      hasCapableDevice: (capabilityId) =>
        port.hasCapableDevice(capabilityId) ||
        (capabilityId === APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID && this.storedSummariesAvailable),
    };
  }

  /**
   * The stored answer to a read the phone could not serve. Undefined when
   * storage is off or holds nothing for the window. Hourly buckets are never
   * stored, so an hourly request gets daily records.
   */
  public async readCached(
    request: HealthReadContextArguments,
  ): Promise<AppleHealthReadResultV1 | undefined> {
    const config = await this.healthConfig();
    if (!config.summaryStore.enabled) {
      return undefined;
    }
    return this.readWindow({
      metrics: request.metrics,
      resolveDates: (timeZone) =>
        healthRequestedLocalDates(
          request.range,
          request.includePreviousPeriod === true,
          timeZone,
          this.now(),
        ),
      includeBaseline: request.includeBaseline === true,
    });
  }

  public async runDigest(trigger: 'scheduled' | 'manual'): Promise<HealthDigestOutcome> {
    const outcome = await this.attemptDigest(trigger).catch(
      (error: unknown): HealthDigestOutcome => ({
        ok: false,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    // A scheduled digest still waiting for today's sync has not used its slot.
    if (!(trigger === 'scheduled' && outcome.status === 'skipped')) {
      await this.writeDigestState({
        lastRunAt: this.now().toISOString(),
        lastStatus: outcome.status,
        ...(outcome.message === undefined ? {} : { lastMessage: outcome.message }),
        ...(outcome.sessionId === undefined ? {} : { lastSessionId: outcome.sessionId }),
      });
    }
    return outcome;
  }

  private async attemptDigest(trigger: 'scheduled' | 'manual'): Promise<HealthDigestOutcome> {
    const config = await this.healthConfig();
    const digest = config.digest;
    if (!config.summaryStore.enabled) {
      return { ok: false, status: 'error', message: 'health summary storage is off' };
    }
    if (digest.model === null) {
      return { ok: false, status: 'error', message: 'no digest model is selected' };
    }
    const windowDays =
      digest.cadence === 'weekly' ? DIGEST_WEEKLY_WINDOW_DAYS : DIGEST_DAILY_WINDOW_DAYS;
    const now = this.now();
    const result = await this.readWindow({
      metrics: digest.metrics,
      resolveDates: (timeZone) => trailingLocalDates(windowDays, timeZone, now),
      includeBaseline: true,
    });
    if (result === undefined) {
      return { ok: false, status: 'skipped', message: 'no synced health summaries yet' };
    }
    const today = formatLocalDateInTimeZone(now, result.timeZone);
    const syncedToday = formatLocalDateInTimeZone(new Date(result.generatedAt), result.timeZone) === today;
    if (trigger === 'scheduled' && !syncedToday && this.withinSyncGrace(digest.time, now)) {
      return { ok: false, status: 'skipped', message: 'waiting for the phone to sync today' };
    }
    const created = await this.runCommand({
      type: 'session/create',
      input: {
        scope: { kind: 'general' },
        model: digest.model,
        sessionName: healthDigestSessionName(digest.cadence, today),
      },
    });
    const sessionId = readSessionId(created);
    if (sessionId === undefined) {
      return {
        ok: false,
        status: 'error',
        message: created.success ? 'digest session was not created' : created.error,
      };
    }
    const prompted = await this.runCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: buildHealthDigestPrompt({ cadence: digest.cadence, result, today, syncedToday }) },
    });
    if (!prompted.success) {
      return { ok: false, status: 'error', message: prompted.error, sessionId };
    }
    return { ok: true, status: 'ok', sessionId };
  }

  private async readWindow(input: {
    metrics: HealthReadContextArguments['metrics'];
    resolveDates: (timeZone: string) => string[];
    includeBaseline: boolean;
  }): Promise<AppleHealthReadResultV1 | undefined> {
    const probe = await this.store.read({
      metrics: [],
      startDate: '0000-01-01',
      endDateExclusive: '0000-01-02',
    });
    if (probe.timeZone === undefined || probe.lastSyncAt === undefined) {
      return undefined;
    }
    const timeZone = probe.timeZone;
    const dates = input.resolveDates(timeZone);
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first === undefined || last === undefined) {
      return undefined;
    }
    const endDateExclusive = addLocalDays(last, 1);
    const { records } = await this.store.read({
      metrics: input.metrics,
      startDate: first,
      endDateExclusive,
    });
    if (records.length === 0) {
      return undefined;
    }
    const present = new Set(records.map((record) => record.metric));
    const result: AppleHealthReadResultV1 = {
      schemaVersion: 1,
      source: 'apple-health',
      timeZone,
      startAt: zonedMidnight(first, timeZone),
      endAt: zonedMidnight(endDateExclusive, timeZone),
      generatedAt: probe.lastSyncAt,
      records,
      unavailableMetrics: input.metrics
        .filter((metric) => !present.has(metric))
        .map((metric) => ({ metric, reason: 'not-authorized-or-no-data' as const })),
      warnings: ['host-cache'],
    };
    if (result.unavailableMetrics.length > 0) {
      result.warnings.push('partial-result');
    }
    if (input.includeBaseline) {
      const window = {
        startDate: addLocalDays(last, -APPLE_HEALTH_BASELINE_WINDOW_DAYS),
        endDateExclusive: last,
      };
      const baseline = await this.store.read({ metrics: input.metrics, ...window });
      result.baselines = computeHealthBaselines({
        metrics: input.metrics,
        baselineRecords: baseline.records,
        records,
        window,
        latestLocalDate: last,
        todayLocalDate: formatLocalDateInTimeZone(this.now(), timeZone),
      });
    }
    return result;
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const config = await this.healthConfig();
      const state = await this.readDigestState();
      if (isHealthDigestDue(config.digest, this.now(), state.lastRunAt)) {
        await this.runDigest('scheduled');
      }
    } catch (error) {
      this.report(error);
    } finally {
      this.ticking = false;
    }
  }

  private withinSyncGrace(time: string, now: Date): boolean {
    const [hours, minutes] = time.split(':').map(Number);
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours ?? 0, minutes ?? 0);
    return now.getTime() - slot.getTime() < DIGEST_SYNC_GRACE_MS;
  }

  private async refreshAvailability(force = false): Promise<void> {
    if (!force && !(await this.isStorageEnabled())) {
      return;
    }
    const devices = await this.store.status();
    this.storedSummariesAvailable = devices.some((device) => device.recordCount > 0);
  }

  private async healthConfig(): Promise<HealthConfig> {
    return normalizeHealthConfig((await this.loadConfig()).health);
  }

  private async readDigestState(): Promise<HealthDigestRunStatus> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, 'utf8'));
      return typeof parsed === 'object' && parsed !== null ? (parsed as HealthDigestRunStatus) : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeDigestState(state: HealthDigestRunStatus): Promise<void> {
    await mkdir(join(this.statePath, '..'), { recursive: true, mode: 0o700 });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }

  private report(error: unknown): void {
    this.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

function readSessionId(response: HostResponse): string | undefined {
  if (!response.success) {
    return undefined;
  }
  const data = response.data as { sessionId?: unknown } | undefined;
  return typeof data?.sessionId === 'string' ? data.sessionId : undefined;
}

function trailingLocalDates(days: number, timeZone: string, now: Date): string[] {
  const today = formatLocalDateInTimeZone(now, timeZone);
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(addLocalDays(today, -offset));
  }
  return dates;
}

function addLocalDays(localDate: string, days: number): string {
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The instant a local date begins in `timeZone`, as RFC 3339. */
function zonedMidnight(localDate: string, timeZone: string): string {
  const utcGuess = Date.parse(`${localDate}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcGuess));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallClockAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
  );
  // How far the zone's wall clock runs ahead of UTC at that instant.
  const offsetMs = wallClockAsUtc - utcGuess;
  return new Date(utcGuess - offsetMs).toISOString();
}
