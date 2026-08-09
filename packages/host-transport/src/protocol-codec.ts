import type {
  HostCommandFrame,
  HostErrorFrame,
  HostHello,
  HostHydrationFrame,
  HostPushBatchFrame,
  HostPushFrame,
  HostReplayDoneFrame,
  HostReplayFrame,
  HostResponseFrame,
  HostSnapshotFrame,
  HostWireMessage,
} from '@piwin/contracts';

const HOST_WIRE_TYPES = new Set<HostWireMessage['type']>([
  'client/hello',
  'host/hello',
  'command',
  'response',
  'push',
  'push/batch',
  'replay',
  'replay/done',
  'snapshot',
  'hydration',
  'error',
]);

export const HOST_WIRE_HARD_FRAME_BYTES = 1_048_576;

export class HostProtocolError extends Error {
  public readonly name = 'HostProtocolError';

  public constructor(message: string) {
    super(message);
  }
}

export function encodeHostWireMessage(message: HostWireMessage): string {
  const encoded = JSON.stringify(message);
  if (encoded === undefined) {
    throw new HostProtocolError('Host wire message cannot be encoded');
  }
  assertWithinFrameCap(encoded);

  return encoded;
}

export function decodeHostWireMessage(serialized: string): HostWireMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new HostProtocolError(`Invalid Host wire JSON: ${reason}`);
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new HostProtocolError('Host wire message must be an object with a type');
  }

  if (!HOST_WIRE_TYPES.has(parsed.type as HostWireMessage['type'])) {
    throw new HostProtocolError(`Unknown Host wire message type: ${parsed.type}`);
  }

  validateRequiredFields(parsed);
  assertWithinFrameCap(serialized);
  return parsed as HostWireMessage;
}

function validateRequiredFields(message: Record<string, unknown>): void {
  const messageType = message.type;
  if (
    (messageType === 'client/hello' ||
      messageType === 'host/hello' ||
      messageType === 'command' ||
      messageType === 'response' ||
      messageType === 'replay' ||
      messageType === 'replay/done') &&
    typeof message.requestId !== 'string' &&
    messageType !== 'client/hello' &&
    messageType !== 'host/hello'
  ) {
    throw new HostProtocolError(`${messageType} requires requestId`);
  }

  if (messageType === 'command' && !isRecord(message.command)) {
    throw new HostProtocolError('command requires a command object');
  }

  if (messageType === 'push') {
    if (typeof message.seq !== 'number' || typeof message.eventId !== 'string') {
      throw new HostProtocolError('push requires seq and eventId');
    }
    if (!isRecord(message.push)) {
      throw new HostProtocolError('push requires a push object');
    }
    validateSequencedPush(message.seq, message.eventId, message.push);
  }

  if (messageType === 'push/batch') {
    validatePushBatch(message);
  }

  if (messageType === 'response' && !isRecord(message.response)) {
    throw new HostProtocolError('response requires a response object');
  }

  if (messageType === 'replay' && typeof message.sinceSeq !== 'number') {
    throw new HostProtocolError('replay requires sinceSeq');
  }

  if (messageType === 'hydration') {
    validateHydration(message);
  }
}

function validateHydration(
  message: Record<string, unknown>,
): asserts message is HostHydrationFrame {
  if (!isRecord(message.snapshot)) {
    throw new HostProtocolError('hydration requires a snapshot');
  }
  const snapshot = message.snapshot;
  if (
    typeof snapshot.snapshotId !== 'string' ||
    snapshot.snapshotId.length === 0 ||
    typeof snapshot.hostInstanceId !== 'string' ||
    snapshot.hostInstanceId.length === 0 ||
    !isSafeSeq(snapshot.snapshotSeq) ||
    !isRecord(snapshot.status) ||
    !Array.isArray(snapshot.sessions) ||
    !isRecord(snapshot.messagesBySession) ||
    !Array.isArray(snapshot.truncatedSessionIds)
  ) {
    throw new HostProtocolError('hydration snapshot is malformed');
  }
  if (
    message.reason !== 'replay-too-old' &&
    message.reason !== 'host-instance-changed' &&
    message.reason !== 'requested'
  ) {
    throw new HostProtocolError('hydration reason is invalid');
  }
}

function validatePushBatch(
  message: Record<string, unknown>,
): asserts message is HostPushBatchFrame {
  if (typeof message.hostInstanceId !== 'string' || message.hostInstanceId.length === 0) {
    throw new HostProtocolError('push/batch requires hostInstanceId');
  }
  if (!isSafeSeq(message.afterSeq) || !isSafeSeq(message.throughSeq)) {
    throw new HostProtocolError('push/batch requires safe cursor sequences');
  }
  if (message.throughSeq < message.afterSeq) {
    throw new HostProtocolError('push/batch throughSeq cannot precede afterSeq');
  }
  if (!Array.isArray(message.items)) {
    throw new HostProtocolError('push/batch requires items');
  }

  let previousSeq = message.afterSeq;
  for (const item of message.items) {
    if (!isRecord(item)) {
      throw new HostProtocolError('push/batch items must be objects');
    }
    if (!isSafeSeq(item.seq) || item.seq <= previousSeq || item.seq > message.throughSeq) {
      throw new HostProtocolError('push/batch item sequences must be increasing and in range');
    }
    if (typeof item.eventId !== 'string' || item.eventId.length === 0) {
      throw new HostProtocolError('push/batch item eventId must be non-empty');
    }
    if (!isRecord(item.push)) {
      throw new HostProtocolError('push/batch item push must be an object');
    }
    validateSequencedPush(item.seq, item.eventId, item.push);
    previousSeq = item.seq;
  }
}

function validateSequencedPush(seq: number, eventId: string, push: Record<string, unknown>): void {
  if (push.seq !== undefined && push.seq !== seq) {
    throw new HostProtocolError('inner push seq disagrees with its envelope');
  }
  if (push.eventId !== undefined && push.eventId !== eventId) {
    throw new HostProtocolError('inner push eventId disagrees with its envelope');
  }
}

function isSafeSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assertWithinFrameCap(serialized: string): void {
  if (new TextEncoder().encode(serialized).byteLength > HOST_WIRE_HARD_FRAME_BYTES) {
    throw new HostProtocolError(`Host wire frame exceeds ${HOST_WIRE_HARD_FRAME_BYTES} bytes`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type HostProtocolFrameTypes = {
  command: HostCommandFrame;
  error: HostErrorFrame;
  hello: HostHello;
  push: HostPushFrame;
  pushBatch: HostPushBatchFrame;
  replay: HostReplayFrame;
  replayDone: HostReplayDoneFrame;
  response: HostResponseFrame;
  snapshot: HostSnapshotFrame;
  hydration: HostHydrationFrame;
};
