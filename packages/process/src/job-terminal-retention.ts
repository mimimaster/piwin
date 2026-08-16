/**
 * Bounded retention for terminalized jobs.
 *
 * Terminal job entries and their log ring buffers are memory the host keeps
 * only for recent-history visibility; records themselves stay durable in the
 * record store. This module tracks terminalization order and enforces two
 * caps: how many terminal entries stay resident, and how many terminal jobs
 * keep their log buffer (each buffer may hold up to 2MB of redacted logs).
 */

/** Default terminal entries kept resident for history visibility. */
export const DEFAULT_MAX_RETAINED_TERMINAL_ENTRIES = 64;

/** Default terminal jobs whose log ring buffer stays resident. */
export const DEFAULT_MAX_RETAINED_TERMINAL_LOG_JOBS = 8;

export type JobTerminalRetentionOptions = {
  /** Maximum terminal entries kept resident in the registry map. */
  maxRetainedTerminalEntries: number;
  /** Maximum terminal jobs whose log buffers stay resident. */
  maxRetainedTerminalLogJobs: number;
  /** Remove a terminal job's resident registry entry. */
  dropEntry: (jobId: string) => void;
  /** Release a terminal job's log ring buffer. */
  clearLogs: (jobId: string) => void;
};

export class JobTerminalRetention {
  /** Terminalized job ids in terminal order (oldest first). */
  private readonly terminalOrder: string[] = [];
  /** Prefix length of `terminalOrder` whose log buffers were already cleared. */
  private logClearCount = 0;
  private readonly options: JobTerminalRetentionOptions;

  constructor(options: JobTerminalRetentionOptions) {
    this.options = options;
  }

  /** Record a freshly terminal job, then evict beyond the caps. */
  retain(jobId: string): void {
    this.terminalOrder.push(jobId);
    this.evictExcess();
  }

  /** Seed an already-terminal id (startup reconcile), oldest-first. */
  seed(jobId: string): void {
    this.terminalOrder.push(jobId);
  }

  /** Drop memory held by old terminal jobs: log buffers first, then entries. */
  evictExcess(): void {
    while (
      this.terminalOrder.length - this.logClearCount >
      this.options.maxRetainedTerminalLogJobs
    ) {
      const jobId = this.terminalOrder[this.logClearCount];
      if (jobId === undefined) break;
      this.options.clearLogs(jobId);
      this.logClearCount += 1;
    }
    while (this.terminalOrder.length > this.options.maxRetainedTerminalEntries) {
      const jobId = this.terminalOrder.shift();
      if (jobId === undefined) break;
      this.options.dropEntry(jobId);
      // The shifted id sat at the array front; it was log-cleared only when
      // the clear cursor had already reached past it.
      if (this.logClearCount > 0) {
        this.logClearCount -= 1;
      }
    }
  }
}
