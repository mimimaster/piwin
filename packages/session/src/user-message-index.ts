import { Buffer } from 'node:buffer';
import {
  SESSION_USER_MESSAGE_INDEX_MAX_BYTES,
  SESSION_USER_MESSAGE_INDEX_MAX_TICKS,
  SESSION_USER_MESSAGE_INDEX_MIN_TICKS,
  SESSION_USER_MESSAGE_PREVIEW_CHARS,
  type SessionUserMessageAnchor,
  type SessionUserMessageIndexData,
  type SessionUserMessageIndexQuery,
} from '@piwin/contracts';

export type UserMessageIndexRow = {
  messageId: string;
  createdAt: string;
  ordinal: number;
  spanStartOrdinal: number;
  spanEndOrdinal: number;
  preview: string;
};

export function validateUserMessageIndexQuery(
  query: SessionUserMessageIndexQuery,
  sessionId: string,
): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('User-message index session does not match the opened transcript store');
  }
  if (
    !Number.isSafeInteger(query.maximumTicks) ||
    query.maximumTicks < SESSION_USER_MESSAGE_INDEX_MIN_TICKS ||
    query.maximumTicks > SESSION_USER_MESSAGE_INDEX_MAX_TICKS
  ) {
    throw new RangeError(
      `User-message index tick limit must be between ${SESSION_USER_MESSAGE_INDEX_MIN_TICKS} and ${SESSION_USER_MESSAGE_INDEX_MAX_TICKS}`,
    );
  }
}

export function createUserMessageIndexData(input: {
  sessionId: string;
  revision: string;
  totalUserMessages: number;
  maximumTicks: number;
  rows: readonly UserMessageIndexRow[];
}): SessionUserMessageIndexData {
  const anchors = input.rows.map((row) => ({
    messageId: row.messageId,
    ordinal: row.ordinal,
    createdAt: row.createdAt,
    preview: normalizePreview(row.preview),
    spanStartOrdinal: row.spanStartOrdinal,
    spanEndOrdinal: row.spanEndOrdinal,
  }));
  const fitted = fitAnchorsToByteBudget(anchors, input.maximumTicks);
  return {
    sessionId: input.sessionId,
    revision: input.revision,
    totalUserMessages: input.totalUserMessages,
    mode: input.totalUserMessages > anchors.length ? 'sampled' : fitted.mode,
    anchors: fitted.anchors,
    anchorBytes: serializedAnchorBytes(fitted.anchors),
  };
}

function normalizePreview(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= SESSION_USER_MESSAGE_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, SESSION_USER_MESSAGE_PREVIEW_CHARS - 1)}…`;
}

function fitAnchorsToByteBudget(
  anchors: SessionUserMessageAnchor[],
  maximumTicks: number,
): { anchors: SessionUserMessageAnchor[]; mode: 'exact' | 'sampled' } {
  if (serializedAnchorBytes(anchors) <= SESSION_USER_MESSAGE_INDEX_MAX_BYTES) {
    return { anchors, mode: 'exact' };
  }

  let current = anchors.map((anchor) => ({
    ...anchor,
    preview: normalizePreview(anchor.preview.slice(0, 64)),
  }));
  if (serializedAnchorBytes(current) <= SESSION_USER_MESSAGE_INDEX_MAX_BYTES) {
    return { anchors: current, mode: 'sampled' };
  }

  let targetCount = Math.max(
    1,
    Math.min(
      maximumTicks,
      Math.max(SESSION_USER_MESSAGE_INDEX_MIN_TICKS, Math.floor(current.length / 2)),
    ),
  );
  for (let attempt = 0; attempt < 16; attempt += 1) {
    current = sampleAnchors(current, targetCount);
    if (serializedAnchorBytes(current) <= SESSION_USER_MESSAGE_INDEX_MAX_BYTES) {
      return { anchors: current, mode: 'sampled' };
    }
    if (current.length <= 1) {
      break;
    }
    targetCount = Math.max(1, Math.floor(current.length / 2));
  }
  while (
    current.length > 0 &&
    serializedAnchorBytes(current) > SESSION_USER_MESSAGE_INDEX_MAX_BYTES
  ) {
    current = current.slice(0, current.length - 1);
  }
  return { anchors: current, mode: 'sampled' };
}

export function sampleUserMessageIndexRows(
  rows: readonly UserMessageIndexRow[],
  maximumTicks: number,
): UserMessageIndexRow[] {
  if (rows.length <= maximumTicks) {
    return [...rows];
  }
  const sampled: UserMessageIndexRow[] = [];
  for (let index = 0; index < maximumTicks; index += 1) {
    const bucketStart = Math.floor((index * rows.length) / maximumTicks);
    const bucketEnd = Math.max(
      bucketStart + 1,
      Math.floor(((index + 1) * rows.length) / maximumTicks),
    );
    const representativeIndex = Math.min(rows.length - 1, bucketStart);
    const representative = rows[representativeIndex];
    if (!representative) continue;
    sampled.push({
      ...representative,
      spanStartOrdinal: rows[bucketStart]?.ordinal ?? representative.ordinal,
      spanEndOrdinal: rows[bucketEnd - 1]?.ordinal ?? representative.ordinal,
    });
  }
  return sampled;
}

function sampleAnchors(
  anchors: readonly SessionUserMessageAnchor[],
  maximumTicks: number,
): SessionUserMessageAnchor[] {
  return sampleUserMessageIndexRows(
    anchors.map((anchor) => ({
      messageId: anchor.messageId,
      createdAt: anchor.createdAt,
      ordinal: anchor.ordinal,
      spanStartOrdinal: anchor.spanStartOrdinal,
      spanEndOrdinal: anchor.spanEndOrdinal,
      preview: anchor.preview,
    })),
    maximumTicks,
  ).map((row) => ({
    messageId: row.messageId,
    ordinal: row.ordinal,
    createdAt: row.createdAt,
    preview: row.preview,
    spanStartOrdinal: row.spanStartOrdinal,
    spanEndOrdinal: row.spanEndOrdinal,
  }));
}

function serializedAnchorBytes(anchors: readonly SessionUserMessageAnchor[]): number {
  return Buffer.byteLength(JSON.stringify(anchors), 'utf8');
}
