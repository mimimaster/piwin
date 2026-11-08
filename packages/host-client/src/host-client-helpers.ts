import type {
  HostClientCapabilities,
  HostClientSubscriptions,
  HostCommand,
  HostHydrationFrame,
  HostPushBatchFrame,
} from '@piwin/contracts';
import { LIVE_JOB_LOG_MAX_IDS, LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';

type LastSeqStore = {
  read(): number;
  write(lastSeq: number): void;
};

export function addCommandId(command: HostCommand, requestId: string): HostCommand {
  if (command.id !== undefined) {
    return command;
  }
  return { ...command, id: requestId } as HostCommand;
}

export function createRequestId(prefix: string): string {
  const cryptoObject = (
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto;
  if (cryptoObject?.randomUUID !== undefined) {
    return `${prefix}-${cryptoObject.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createMemoryLastSeqStore(): LastSeqStore {
  let value = 0;
  return {
    read: () => value,
    write: (nextValue) => {
      value = nextValue;
    },
  };
}

export function readLastSeq(store: LastSeqStore): number {
  const value = store.read();
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function isValidPushBatch(frame: HostPushBatchFrame): boolean {
  if (!Number.isSafeInteger(frame.afterSeq) || frame.afterSeq < 0) return false;
  if (!Number.isSafeInteger(frame.throughSeq) || frame.throughSeq < frame.afterSeq) return false;
  if (frame.hostInstanceId.trim().length === 0) return false;

  let previousSeq = frame.afterSeq;
  for (const item of frame.items) {
    if (
      !Number.isSafeInteger(item.seq) ||
      item.seq <= previousSeq ||
      item.seq > frame.throughSeq ||
      item.eventId.trim().length === 0
    ) {
      return false;
    }
    if (item.push.seq !== undefined && item.push.seq !== item.seq) return false;
    if (item.push.eventId !== undefined && item.push.eventId !== item.eventId) return false;
    previousSeq = item.seq;
  }
  return true;
}

export function isValidHydrationFrame(frame: HostHydrationFrame): boolean {
  const snapshot = frame.snapshot;
  return (
    (frame.reason === 'replay-too-old' ||
      frame.reason === 'host-instance-changed' ||
      frame.reason === 'requested') &&
    snapshot.snapshotId.trim().length > 0 &&
    snapshot.hostInstanceId.trim().length > 0 &&
    Number.isSafeInteger(snapshot.snapshotSeq) &&
    snapshot.snapshotSeq >= 0 &&
    Array.isArray(snapshot.sessions) &&
    typeof snapshot.messagesBySession === 'object' &&
    snapshot.messagesBySession !== null &&
    Array.isArray(snapshot.truncatedSessionIds)
  );
}

export function omitClientTools(capabilities: HostClientCapabilities): HostClientCapabilities {
  const { clientTools: _ignored, ...rest } = capabilities;
  return rest;
}

export function countAdmissionKeys(options: {
  authToken?: string;
  pairingToken?: string;
  deviceCredential?: unknown;
}): number {
  return (
    Number(options.authToken !== undefined && options.authToken.length > 0) +
    Number(options.pairingToken !== undefined && options.pairingToken.trim().length > 0) +
    Number(options.deviceCredential !== undefined)
  );
}

export function normalizeSubscriptions(
  subscriptions: HostClientSubscriptions | undefined,
): HostClientSubscriptions | undefined {
  const sessionIds = normalizeSubscriptionIds(
    subscriptions?.sessionIds,
    LIVE_SUBSCRIPTION_MAX_SESSION_IDS,
  );
  const jobIds = normalizeSubscriptionIds(subscriptions?.jobIds, LIVE_JOB_LOG_MAX_IDS);
  if (sessionIds === undefined && jobIds === undefined) {
    return undefined;
  }
  return {
    ...(sessionIds === undefined ? {} : { sessionIds }),
    ...(jobIds === undefined ? {} : { jobIds }),
  };
}

function normalizeSubscriptionIds(ids: string[] | undefined, max: number): string[] | undefined {
  if (!Array.isArray(ids)) return undefined;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 256 || seen.has(id)) {
      continue;
    }
    normalized.push(id);
    seen.add(id);
    if (normalized.length >= max) break;
  }
  return normalized.length === 0 ? undefined : normalized;
}

export function getSmallestPendingSeq(pendingPushes: Map<number, { seq: number }>): number {
  let smallest = Number.MAX_SAFE_INTEGER;
  for (const sequence of pendingPushes.keys()) {
    smallest = Math.min(smallest, sequence);
  }
  return smallest === Number.MAX_SAFE_INTEGER ? 0 : smallest;
}

export function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
