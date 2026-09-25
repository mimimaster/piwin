import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostPush, QueuedTurnRecord, RunInterventionRecord } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { createMobileIdempotencyKey } from '../../mobile-prompt-send.js';

/**
 * Host-owned follow-up messages for a busy session (ADR 0051): queued turns
 * wait for the run to end; interventions are injected into the live run. The
 * phone mirrors both and relays cancel / "插话" (adopt queued turn as an
 * intervention); ordering and admission stay with the Host.
 */
export interface SessionQueueState {
  queued: QueuedTurnRecord[];
  interventions: RunInterventionRecord[];
  cancelQueued: (record: QueuedTurnRecord) => Promise<string | undefined>;
  interveneNow: (record: QueuedTurnRecord, runId: string) => Promise<string | undefined>;
}

const LIVE_QUEUE: ReadonlySet<QueuedTurnRecord['status']> = new Set(['pending', 'starting']);
const LIVE_INTERVENTION: ReadonlySet<RunInterventionRecord['status']> = new Set([
  'pending',
  'applying',
  'uncertain',
]);

export function useSessionQueue(client: HostClient | undefined, sessionId: string | undefined): SessionQueueState {
  const [queued, setQueued] = useState<QueuedTurnRecord[]>([]);
  const [interventions, setInterventions] = useState<RunInterventionRecord[]>([]);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    setQueued([]);
    setInterventions([]);
    if (client === undefined || sessionId === undefined || !client.supportsCommand('session/queued-turn-list')) {
      return;
    }
    let cancelled = false;
    void client
      .request({ type: 'session/queued-turn-list', sessionId })
      .then((response) => {
        if (cancelled || !response.success) return;
        const records = readQueuedTurns(response.data);
        setQueued((current) => mergeQueued(current, records));
      })
      .catch((error: unknown) => {
        console.warn('[mobile] session/queued-turn-list failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  useEffect(() => {
    if (client === undefined) return undefined;
    return client.subscribePush((push: HostPush) => {
      if (push.type === 'session/queued-turn-updated' && push.queuedTurn.sessionId === sessionRef.current) {
        setQueued((current) => mergeQueued(current, [push.queuedTurn]));
      } else if (
        push.type === 'run/intervention-updated' &&
        push.intervention.sessionId === sessionRef.current
      ) {
        setInterventions((current) => upsertIntervention(current, push.intervention));
      }
    });
  }, [client]);

  const cancelQueued = useCallback(
    async (record: QueuedTurnRecord): Promise<string | undefined> => {
      if (client === undefined) return '未连接 Host。';
      const response = await client.request({
        type: 'session/queued-turn-cancel',
        sessionId: record.sessionId,
        queuedTurnId: record.queuedTurnId,
        expectedRevision: record.revision,
      });
      return response.success ? undefined : response.error;
    },
    [client],
  );

  const interveneNow = useCallback(
    async (record: QueuedTurnRecord, runId: string): Promise<string | undefined> => {
      if (client === undefined) return '未连接 Host。';
      const response = await client.request({
        type: 'run/intervention-submit',
        sessionId: record.sessionId,
        runId,
        interventionId: createMobileIdempotencyKey(),
        userMessageId: record.userMessageId,
        input: { text: record.input.text },
        adoptQueuedTurn: { queuedTurnId: record.queuedTurnId, expectedRevision: record.revision },
      });
      return response.success ? undefined : response.error;
    },
    [client],
  );

  return {
    queued: queued.filter((record) => LIVE_QUEUE.has(record.status)),
    interventions: interventions.filter((record) => LIVE_INTERVENTION.has(record.status)),
    cancelQueued,
    interveneNow,
  };
}

/** Keep the highest revision per id; order by Host sequence. */
export function mergeQueued(current: QueuedTurnRecord[], incoming: QueuedTurnRecord[]): QueuedTurnRecord[] {
  const byId = new Map(current.map((record) => [record.queuedTurnId, record]));
  for (const record of incoming) {
    const existing = byId.get(record.queuedTurnId);
    if (existing === undefined || record.revision >= existing.revision) {
      byId.set(record.queuedTurnId, record);
    }
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

function upsertIntervention(
  current: RunInterventionRecord[],
  record: RunInterventionRecord,
): RunInterventionRecord[] {
  const existing = current.find((item) => item.interventionId === record.interventionId);
  if (existing !== undefined && existing.revision > record.revision) return current;
  const rest = current.filter((item) => item.interventionId !== record.interventionId);
  return [...rest, record].sort((left, right) => left.sequence - right.sequence);
}

function readQueuedTurns(data: unknown): QueuedTurnRecord[] {
  if (typeof data !== 'object' || data === null) return [];
  const list = (data as { queuedTurns?: unknown }).queuedTurns;
  return Array.isArray(list) ? (list as QueuedTurnRecord[]) : [];
}
