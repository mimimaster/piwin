import type { HostCommand } from '@piwin/contracts';
import type { HostServeCommandLane } from './host-serve-command-lane.js';

/**
 * Ages at which a still-running command handler leaves a line in the Host
 * log. The `slow command` line only appears once a command finishes, so a
 * handler that never settles would otherwise leave no trace at all.
 */
export const LONG_RUNNING_COMMAND_REPORT_MS: readonly number[] = [
  30_000, 120_000, 600_000, 1_800_000,
];
/** After the last fixed threshold, repeat at this interval. */
const LONG_RUNNING_COMMAND_REPEAT_MS = 1_800_000;

export type InFlightCommandSnapshot = {
  type: HostCommand['type'];
  lane: HostServeCommandLane;
  ageMs: number;
  /** The dispatcher deadline already answered the client; the handler kept running. */
  timedOut: boolean;
};

export type InFlightCommandEntry = {
  readonly type: HostCommand['type'];
  readonly lane: HostServeCommandLane;
  readonly startedAt: number;
  timedOut: boolean;
  /** Next age (ms) at which this entry is reported. */
  nextReportAtMs: number;
};

export type InFlightCommandTracker = {
  begin: (type: HostCommand['type'], lane: HostServeCommandLane) => InFlightCommandEntry;
  end: (entry: InFlightCommandEntry) => void;
  snapshot: () => InFlightCommandSnapshot[];
  /** Log handlers that crossed their next report age; returns lines written. */
  reportLongRunning: () => number;
};

/** The report age that follows `currentMs` in the fixed + repeating schedule. */
export function nextLongRunningReportAge(currentMs: number): number {
  for (const threshold of LONG_RUNNING_COMMAND_REPORT_MS) {
    if (threshold > currentMs) return threshold;
  }
  return currentMs + LONG_RUNNING_COMMAND_REPEAT_MS;
}

export function formatInFlightCommands(commands: readonly InFlightCommandSnapshot[]): string {
  if (commands.length === 0) return 'none';
  return [...commands]
    .sort((left, right) => right.ageMs - left.ageMs)
    .map(
      (command) =>
        `${command.type}(lane=${command.lane} age=${command.ageMs}ms${command.timedOut ? ' timed-out' : ''})`,
    )
    .join(', ');
}

export function createInFlightCommandTracker(options: {
  now?: () => number;
  log: (line: string) => void;
}): InFlightCommandTracker {
  const now = options.now ?? Date.now;
  const entries = new Set<InFlightCommandEntry>();

  function snapshot(): InFlightCommandSnapshot[] {
    const at = now();
    return [...entries].map((entry) => ({
      type: entry.type,
      lane: entry.lane,
      ageMs: at - entry.startedAt,
      timedOut: entry.timedOut,
    }));
  }

  function reportLongRunning(): number {
    const at = now();
    let written = 0;
    for (const entry of entries) {
      const ageMs = at - entry.startedAt;
      if (ageMs < entry.nextReportAtMs) continue;
      entry.nextReportAtMs = nextLongRunningReportAge(ageMs);
      options.log(
        `[piwin host serve] command still running ${entry.type} lane=${entry.lane} age=${ageMs}ms${entry.timedOut ? ' (client already got timeout)' : ''}`,
      );
      written += 1;
    }
    return written;
  }

  return {
    begin: (type, lane) => {
      const entry: InFlightCommandEntry = {
        type,
        lane,
        startedAt: now(),
        timedOut: false,
        nextReportAtMs: nextLongRunningReportAge(0),
      };
      entries.add(entry);
      return entry;
    },
    end: (entry) => {
      entries.delete(entry);
    },
    snapshot,
    reportLongRunning,
  };
}
