import type { HostPushBatchFrame } from '@piwin/contracts';

export function isSafeSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isReplayDoneFrame(
  value: unknown,
): value is { type: 'replay/done'; currentSeq: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === 'replay/done' && isSafeSequence(record.currentSeq);
}

export function isHostPushBatchFrame(value: unknown): value is HostPushBatchFrame {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'push/batch' ||
    typeof record.hostInstanceId !== 'string' ||
    record.hostInstanceId.length === 0 ||
    !isSafeSequence(record.afterSeq) ||
    !isSafeSequence(record.throughSeq) ||
    record.throughSeq < record.afterSeq ||
    !Array.isArray(record.items)
  ) {
    return false;
  }
  let previousSeq = record.afterSeq;
  for (const item of record.items) {
    if (typeof item !== 'object' || item === null) {
      return false;
    }
    const itemRecord = item as Record<string, unknown>;
    const pushRecord =
      typeof itemRecord.push === 'object' && itemRecord.push !== null
        ? (itemRecord.push as Record<string, unknown>)
        : undefined;
    if (
      !isSafeSequence(itemRecord.seq) ||
      itemRecord.seq <= previousSeq ||
      itemRecord.seq > record.throughSeq ||
      typeof itemRecord.eventId !== 'string' ||
      itemRecord.eventId.length === 0 ||
      pushRecord === undefined ||
      (pushRecord.seq !== undefined && pushRecord.seq !== itemRecord.seq) ||
      (pushRecord.eventId !== undefined && pushRecord.eventId !== itemRecord.eventId)
    ) {
      return false;
    }
    previousSeq = itemRecord.seq;
  }
  return true;
}
