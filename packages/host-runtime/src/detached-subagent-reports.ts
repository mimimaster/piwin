/**
 * Detached subagents (the Auto tester) outlive the parent run that started
 * them. This module owns their per-session registry and the late delivery of
 * their reports: injected into the next prompt preparation, or — when the
 * session goes idle with the report still unread — a Host continuation turn.
 */
import { formatError, type HostPush } from '@piwin/contracts';

export const PIWIN_TESTER_REPORT_MARKER = '[piwin-tester-report]';

/** Replaces the generic continuation text when a report is what woke the turn. */
export const DETACHED_REPORT_CONTINUATION_PROMPT =
  'A background subagent you started earlier has finished; its report is above. ' +
  'Fold it into a complete answer for the user: state the verdict (pass | fail | blocked) with the key evidence, ' +
  'and if it failed, say what you will fix or ask the user how to proceed. Do not redo work the report already covers.';

type DetachedEntry = {
  runId: string;
  /** Scheme the continuation turn should run under (the scheme that started it). */
  schemeId?: string;
};

export class DetachedSubagentRegistry {
  private readonly bySession = new Map<string, DetachedEntry>();
  private readonly pendingReports = new Map<string, string[]>();

  /** Register a new detached run; returns the run it replaces, if any. */
  replace(sessionId: string, entry: DetachedEntry): string | undefined {
    const previous = this.bySession.get(sessionId);
    this.bySession.set(sessionId, { ...entry });
    return previous && previous.runId !== entry.runId ? previous.runId : undefined;
  }

  isDetached(sessionId: string, runId: string): boolean {
    return this.bySession.get(sessionId)?.runId === runId;
  }

  running(sessionId: string): string | undefined {
    return this.bySession.get(sessionId)?.runId;
  }

  /** Forget a finished run; returns its entry when it was still current. */
  settle(sessionId: string, runId: string): DetachedEntry | undefined {
    const current = this.bySession.get(sessionId);
    if (!current || current.runId !== runId) return undefined;
    this.bySession.delete(sessionId);
    return current;
  }

  addReport(sessionId: string, report: string): void {
    const list = this.pendingReports.get(sessionId) ?? [];
    list.push(report);
    this.pendingReports.set(sessionId, list);
  }

  hasReports(sessionId: string): boolean {
    return (this.pendingReports.get(sessionId)?.length ?? 0) > 0;
  }

  /** Remove and return pending reports as one model-facing block. */
  takeReports(sessionId: string): string | undefined {
    const list = this.pendingReports.get(sessionId);
    if (!list || list.length === 0) return undefined;
    this.pendingReports.delete(sessionId);
    return formatDetachedReportBlock(list);
  }

  disposeSession(sessionId: string): void {
    this.bySession.delete(sessionId);
    this.pendingReports.delete(sessionId);
  }
}

export function formatDetachedReportBlock(reports: readonly string[]): string {
  return [PIWIN_TESTER_REPORT_MARKER, ...reports].join('\n\n');
}

/** One report entry: which run, and the child's final contract message. */
export function formatDetachedReport(input: {
  runId: string;
  executionStatus: string;
  summaryPreview?: string;
  error?: string;
}): string {
  const body =
    input.summaryPreview?.trim() ||
    (input.error ? `blocked\n- ${input.error}` : `blocked\n- no report (${input.executionStatus})`);
  return `tester run ${input.runId} (${input.executionStatus}):\n${body}`;
}

export type DetachedReportDeliveryDeps = {
  registry: DetachedSubagentRegistry;
  getForegroundRunId: (sessionId: string) => string | undefined;
  joinRun: (runId: string) => Promise<unknown>;
  admitContinuation: (
    sessionId: string,
    schemeId: string | undefined,
  ) => Promise<{ success: boolean; error?: string }>;
  push: (message: HostPush) => void;
};

const MAX_DELIVERY_ATTEMPTS = 8;

/**
 * Wait until the session is idle; if the report is still unread by then (no
 * prompt preparation consumed it), start a Host continuation turn for it.
 */
export async function deliverDetachedReport(
  deps: DetachedReportDeliveryDeps,
  sessionId: string,
  schemeId: string | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    const foreground = deps.getForegroundRunId(sessionId);
    if (foreground) {
      await deps.joinRun(foreground);
      continue;
    }
    if (!deps.registry.hasReports(sessionId)) return;
    try {
      const response = await deps.admitContinuation(sessionId, schemeId);
      if (response.success) return;
      if (response.error?.includes('run-active')) continue;
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `tester report continuation rejected for ${sessionId}: ${response.error ?? 'unknown'}; report stays queued for the next prompt`,
      });
      return;
    } catch (error) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `tester report continuation failed for ${sessionId}: ${formatError(error)}; report stays queued for the next prompt`,
      });
      return;
    }
  }
}
