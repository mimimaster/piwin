/**
 * Data for 代码撤销记录: the workspace's undo/redo list (paged), one
 * operation's repair preview, and the repair / restore actions. Every write
 * is one gesture with its own idempotency key; the list reloads on
 * `turn-changes/operation-updated` so another client's undo shows up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  TurnChangeOperationEntry,
  TurnChangeOperationPage,
  TurnChangeRepairPreview,
} from '@piwin/contracts';
import { createIdempotencyKey } from '@piwin/host-client';

export type TurnChangeRecordRequest = (
  command: HostCommand,
  options?: { idempotencyKey?: string },
) => Promise<HostResponse>;

export type TurnChangeRecordState = {
  operations: TurnChangeOperationEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore(): void;
  reload(): void;
};

const PAGE_SIZE = 50;

export function useTurnChangeRecord(input: {
  request: TurnChangeRecordRequest;
  subscribePush: (listener: (push: HostPush) => void) => () => void;
  projectPath: string | null;
  enabled: boolean;
}): TurnChangeRecordState {
  const { request, subscribePush, projectPath, enabled } = input;
  const [operations, setOperations] = useState<TurnChangeOperationEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (from: string | null): Promise<void> => {
      if (!projectPath) return;
      const mine = ++generation.current;
      setLoading(true);
      try {
        const response = await request({
          type: 'turn-changes/operations',
          projectPath,
          limit: PAGE_SIZE,
          ...(from !== null ? { cursor: from } : {}),
        });
        if (mine !== generation.current) return;
        if (!response.success) {
          setError(response.error);
          return;
        }
        const page = response.data as TurnChangeOperationPage;
        setError(null);
        setOperations((current) => (from === null ? page.operations : [...current, ...page.operations]));
        setCursor(page.nextCursor);
      } catch (caught) {
        if (mine === generation.current) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [projectPath, request],
  );

  const reload = useCallback(() => {
    void fetchPage(null);
  }, [fetchPage]);

  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    return subscribePush((push) => {
      if (push.type === 'turn-changes/operation-updated') reload();
    });
  }, [enabled, reload, subscribePush]);

  return {
    operations,
    loading,
    error,
    hasMore: cursor !== null,
    loadMore: () => {
      if (cursor !== null && !loading) void fetchPage(cursor);
    },
    reload,
  };
}

export type RepairStep =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'preview'; preview: TurnChangeRepairPreview }
  | { kind: 'repairing' }
  | { kind: 'done' }
  | { kind: 'foreign'; preview: TurnChangeRepairPreview }
  | { kind: 'error'; message: string };

/** Preview → confirm → run → verify for one stuck operation. */
export function useTurnChangeRepair(request: TurnChangeRecordRequest, entry: TurnChangeOperationEntry | null) {
  const [step, setStep] = useState<RepairStep>({ kind: 'idle' });
  const operationId = entry?.operationId ?? null;
  const revision = entry?.revision ?? 0;

  const preview = useCallback(async () => {
    if (!operationId) return;
    setStep({ kind: 'loading' });
    const response = await request({ type: 'turn-changes/recovery-preview', operationId, expectedRevision: revision });
    setStep(
      response.success
        ? { kind: 'preview', preview: response.data as TurnChangeRepairPreview }
        : { kind: 'error', message: response.error },
    );
  }, [operationId, request, revision]);

  useEffect(() => {
    setStep({ kind: 'idle' });
    if (entry?.status === 'needs-repair') void preview();
  }, [entry?.operationId, entry?.status, preview]);

  const repair = useCallback(async () => {
    if (!operationId || step.kind !== 'preview') return;
    const confirmationToken = step.preview.confirmationToken;
    setStep({ kind: 'repairing' });
    const ran = await request(
      { type: 'turn-changes/recovery-run', operationId, expectedRevision: revision, confirmationToken },
      { idempotencyKey: createIdempotencyKey() },
    );
    if (!ran.success) {
      setStep({ kind: 'error', message: ran.error });
      return;
    }
    const verified = await request({ type: 'turn-changes/recovery-verify', operationId, expectedRevision: revision });
    if (!verified.success) {
      setStep({ kind: 'error', message: verified.error });
      return;
    }
    if ((verified.data as { verified: boolean }).verified) {
      setStep({ kind: 'done' });
      return;
    }
    const again = await request({ type: 'turn-changes/recovery-preview', operationId, expectedRevision: revision });
    setStep(
      again.success
        ? { kind: 'foreign', preview: again.data as TurnChangeRepairPreview }
        : { kind: 'error', message: again.error },
    );
  }, [operationId, request, revision, step]);

  return { step, preview, repair };
}
