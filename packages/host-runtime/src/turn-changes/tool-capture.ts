/**
 * Router-facing capture port: admitted writes become durable file_action rows.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { HostToolFileEffect, ToolResult } from '@piwin/contracts';
import {
  persistTurnChangeWriteReceipt,
  type TurnChangeStore,
  type TurnChangeWriteReceipt,
} from '@piwin/git';

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
  }): void;
};

type CaptureSession = {
  runId: string;
  toolCallId: string;
  fileEffect: HostToolFileEffect;
  receipts: TurnChangeWriteReceipt[];
};

const captureScope = new AsyncLocalStorage<string>();

export function runInToolCapture<T>(captureId: string, fn: () => Promise<T>): Promise<T> {
  return captureScope.run(captureId, fn);
}

export function bindCaptureReceipts(
  port: ToolCapturePort,
): (receipt: TurnChangeWriteReceipt) => void {
  return (receipt) => {
    const captureId = captureScope.getStore();
    if (captureId === undefined) {
      return;
    }
    port.recordReceipt({ captureId, receipt });
  };
}

export function createToolCapturePort(options: {
  store: TurnChangeStore;
  changeSetId?: string;
  resolveChangeSetId?: (runId: string) => string | undefined;
}): ToolCapturePort {
  const sessions = new Map<string, CaptureSession>();

  const markIncomplete = (runId: string): void => {
    const changeSetId = options.changeSetId ?? options.resolveChangeSetId?.(runId);
    if (changeSetId) {
      options.store.markAttemptCaptureState(changeSetId, 'incomplete');
    }
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
    },

    async finishCapture(input) {
      const session = sessions.get(input.captureId);
      if (!session) {
        return;
      }
      sessions.delete(input.captureId);
      try {
        if (session.fileEffect.kind === 'uncontained') {
          markIncomplete(session.runId);
          return;
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
      } catch {
        markIncomplete(session.runId);
      }
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
