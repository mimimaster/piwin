/**
 * Router-facing capture port: admitted writes become durable file_action rows.
 *
 * Commands (`fileEffect: uncontained`) used to mark the whole turn incomplete,
 * which made nearly every turn un-undoable — almost every turn runs some
 * `cat` or test. Now a shell reports what it changed (a before/after
 * fingerprint of the workspace) and that audit is stored per call; sealing
 * decides completeness per path. An uncontained call that reports nothing
 * is stored as `unknown`, and a receipt that cannot be persisted as
 * `capture-failed`: both keep the turn from being undone automatically.
 * Audits are rows, not a capture-state flag, so a paused turn that resumes
 * does not forget them.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { HostToolFileEffect, ToolResult } from '@piwin/contracts';
import {
  persistTurnChangeWriteReceipt,
  type TurnChangeStore,
  type TurnChangeWriteReceipt,
} from '@piwin/git';

/** What a command did to the workspace, as its tool reports it. */
export type ShellAuditReport =
  | { status: 'clean' }
  | { status: 'changed'; paths: readonly string[] }
  | { status: 'unknown' };

export type ToolCapturePort = {
  beginCapture(input: {
    runId: string;
    toolCallId: string | undefined;
    toolName: string;
    fileEffect: HostToolFileEffect | undefined;
    canonicalArgs: Record<string, unknown>;
  }): { captureId: string } | undefined;
  finishCapture(input: {
    captureId: string;
    result: ToolResult;
  }): Promise<void>;
  recordReceipt(input: {
    captureId: string;
    receipt: TurnChangeWriteReceipt;
    /** Root the receipt's relative path is under (the tool's workspace root). */
    workspaceRoot?: string;
  }): void;
  recordShellAudit(input: { captureId: string; audit: ShellAuditReport }): void;
  /**
   * Resolves once every capture this run began has finished, or after
   * `timeoutMs` with `false`. Tool timeouts finish their capture later, so
   * sealing must wait here rather than at the run's terminal event.
   */
  waitRunSettled(runId: string, timeoutMs: number): Promise<boolean>;
};

type CaptureSession = {
  runId: string;
  toolCallId: string;
  fileEffect: HostToolFileEffect;
  receipts: TurnChangeWriteReceipt[];
  workspaceRoot?: string;
  shellAudit?: ShellAuditReport;
};

const captureScope = new AsyncLocalStorage<string>();

export function runInToolCapture<T>(captureId: string, fn: () => Promise<T>): Promise<T> {
  return captureScope.run(captureId, fn);
}

export function bindCaptureReceipts(
  port: ToolCapturePort,
  workspaceRoot?: string,
): (receipt: TurnChangeWriteReceipt) => void {
  return (receipt) => {
    const captureId = captureScope.getStore();
    if (captureId === undefined) {
      return;
    }
    port.recordReceipt({ captureId, receipt, ...(workspaceRoot ? { workspaceRoot } : {}) });
  };
}

export function bindCaptureShellAudit(port: ToolCapturePort): (audit: ShellAuditReport) => void {
  return (audit) => {
    const captureId = captureScope.getStore();
    if (captureId === undefined) {
      return;
    }
    port.recordShellAudit({ captureId, audit });
  };
}

export function createToolCapturePort(options: {
  store: TurnChangeStore;
  /** Align the run's turn to the root receipts were written under. */
  alignWorkspace?: (runId: string, workspaceRoot: string) => 'aligned' | 'conflict' | 'unbound';
}): ToolCapturePort {
  const sessions = new Map<string, CaptureSession>();
  const settleWaiters = new Map<string, Set<() => void>>();

  const openCount = (runId: string): number => {
    let count = 0;
    for (const session of sessions.values()) {
      if (session.runId === runId) count += 1;
    }
    return count;
  };

  const notifySettled = (runId: string): void => {
    if (openCount(runId) > 0) return;
    const waiters = settleWaiters.get(runId);
    if (!waiters) return;
    settleWaiters.delete(runId);
    for (const wake of waiters) wake();
  };

  const recordAudit = (
    session: CaptureSession,
    status: 'clean' | 'changed' | 'unknown' | 'capture-failed',
    paths: readonly string[] = [],
  ): void => {
    options.store.recordShellAudit({
      runId: session.runId,
      toolCallId: session.toolCallId,
      status,
      paths,
    });
  };

  return {
    beginCapture(input) {
      const fileEffect = input.fileEffect;
      if (fileEffect === undefined || fileEffect.kind === 'none') {
        return undefined;
      }
      const captureId = randomUUID();
      sessions.set(captureId, {
        runId: input.runId,
        toolCallId: input.toolCallId ?? randomUUID(),
        fileEffect,
        receipts: [],
      });
      return { captureId };
    },

    recordReceipt(input) {
      const session = sessions.get(input.captureId);
      if (!session) {
        return;
      }
      session.receipts.push(input.receipt);
      if (input.workspaceRoot) {
        session.workspaceRoot = input.workspaceRoot;
      }
    },

    recordShellAudit(input) {
      const session = sessions.get(input.captureId);
      if (!session) {
        return;
      }
      session.shellAudit = input.audit;
    },

    async finishCapture(input) {
      const session = sessions.get(input.captureId);
      if (!session) {
        return;
      }
      sessions.delete(input.captureId);
      try {
        if (session.fileEffect.kind === 'uncontained') {
          const audit = session.shellAudit ?? { status: 'unknown' as const };
          recordAudit(session, audit.status, audit.status === 'changed' ? audit.paths : []);
          return;
        }
        if (session.receipts.length > 0 && session.workspaceRoot && options.alignWorkspace) {
          if (options.alignWorkspace(session.runId, session.workspaceRoot) === 'conflict') {
            // Paths relative to two roots cannot share one change set.
            recordAudit(session, 'capture-failed');
            return;
          }
        }
        const settlement = settlementFromResult(input.result);
        for (const [index, receipt] of session.receipts.entries()) {
          persistTurnChangeWriteReceipt({
            store: options.store,
            actionId: randomUUID(),
            runId: session.runId,
            toolCallId: session.toolCallId,
            actionOrdinal: index,
            receipt,
            settlement,
          });
        }
      } catch (error) {
        console.warn('[host-runtime] turn-change capture failed', error);
        try {
          recordAudit(session, 'capture-failed');
        } catch (auditError) {
          console.warn('[host-runtime] turn-change capture failure could not be recorded', auditError);
        }
      } finally {
        notifySettled(session.runId);
      }
    },

    waitRunSettled(runId, timeoutMs) {
      if (openCount(runId) === 0) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          settleWaiters.get(runId)?.delete(wake);
          resolve(false);
        }, timeoutMs);
        const wake = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        let waiters = settleWaiters.get(runId);
        if (!waiters) {
          waiters = new Set();
          settleWaiters.set(runId, waiters);
        }
        waiters.add(wake);
      });
    },
  };
}

function settlementFromResult(result: ToolResult): string {
  if (result.ok) {
    return 'applied';
  }
  if (result.code === 'aborted') {
    return 'aborted';
  }
  return 'failed';
}
