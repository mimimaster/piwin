import type { AgentEvent, HostPush } from '@piwin/contracts';

type StreamDeltaEvent =
  | Extract<AgentEvent, { type: 'message/text_delta' }>
  | Extract<AgentEvent, { type: 'message/thinking_delta' }>
  | Extract<AgentEvent, { type: 'tool/update' }>;

type StreamEventPush = Extract<HostPush, { type: 'event' }>;

type PendingDelta = {
  key: string;
  message: StreamEventPush;
  deltaBytes: number;
};

type QueuedMessage = {
  message: HostPush;
  streamKey: string | undefined;
  deltaBytes: number;
};

export type HostServeStreamBatcher = {
  push: (message: HostPush) => void;
  flush: () => Promise<void>;
};

export type HostServeStreamBatcherOptions = {
  flushIntervalMs?: number;
  /** Maximum number of distinct pending stream deltas before they are queued. */
  maxPendingDeltaEvents?: number;
  /** Maximum UTF-8 payload bytes retained by pending stream deltas. */
  maxPendingDeltaBytes?: number;
  /** Maximum number of queued stream messages while the writer is backpressured. */
  maxWriteBacklogEvents?: number;
  /** Maximum UTF-8 payload bytes queued for stream messages while backpressured. */
  maxWriteBacklogBytes?: number;
  write: (message: HostPush) => Promise<void>;
};

const DEFAULT_STREAM_FLUSH_INTERVAL_MS = 24;
const DEFAULT_MAX_PENDING_DELTA_EVENTS = 128;
const DEFAULT_MAX_PENDING_DELTA_BYTES = 256 * 1024;
const DEFAULT_MAX_WRITE_BACKLOG_EVENTS = 256;
const DEFAULT_MAX_WRITE_BACKLOG_BYTES = 1024 * 1024;

/**
 * Coalesces only high-frequency stream deltas before JSONL serialization.
 * Lifecycle, permission, error, and terminal events flush pending deltas first.
 */
export function createHostServeStreamBatcher(
  options: HostServeStreamBatcherOptions,
): HostServeStreamBatcher {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_STREAM_FLUSH_INTERVAL_MS;
  const maxPendingDeltaEvents = validatePositiveLimit(
    options.maxPendingDeltaEvents ?? DEFAULT_MAX_PENDING_DELTA_EVENTS,
    'maxPendingDeltaEvents',
  );
  const maxPendingDeltaBytes = validatePositiveLimit(
    options.maxPendingDeltaBytes ?? DEFAULT_MAX_PENDING_DELTA_BYTES,
    'maxPendingDeltaBytes',
  );
  const maxWriteBacklogEvents = validatePositiveLimit(
    options.maxWriteBacklogEvents ?? DEFAULT_MAX_WRITE_BACKLOG_EVENTS,
    'maxWriteBacklogEvents',
  );
  const maxWriteBacklogBytes = validatePositiveLimit(
    options.maxWriteBacklogBytes ?? DEFAULT_MAX_WRITE_BACKLOG_BYTES,
    'maxWriteBacklogBytes',
  );
  const pendingDeltas: PendingDelta[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const writeQueue: QueuedMessage[] = [];
  const drainWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  let queuedStreamEvents = 0;
  let queuedStreamBytes = 0;
  let writePumpRunning = false;
  let writeError: unknown = null;

  function takePendingDeltas(): HostPush[] {
    const messages = pendingDeltas.map((pendingDelta) => pendingDelta.message);
    pendingDeltas.length = 0;
    return messages;
  }

  function enqueueWrite(messages: HostPush[]): void {
    for (const message of messages) {
      appendQueuedMessage(message);
    }
    startWritePump();
  }

  function appendQueuedMessage(message: HostPush): void {
    const streamKey = getStreamKey(message);
    const boundedMessage = limitStreamPush(message, maxWriteBacklogBytes);
    const deltaBytes = streamKey === undefined ? 0 : getDeltaBytes(boundedMessage);
    const lastQueuedMessage = writeQueue[writeQueue.length - 1];

    if (streamKey !== undefined && lastQueuedMessage?.streamKey === streamKey) {
      const mergedMessage = limitStreamPush(
        mergeStreamMessages(lastQueuedMessage.message, boundedMessage),
        maxWriteBacklogBytes,
      );
      lastQueuedMessage.message = mergedMessage;
      queuedStreamBytes += getDeltaBytes(mergedMessage) - lastQueuedMessage.deltaBytes;
      lastQueuedMessage.deltaBytes = getDeltaBytes(mergedMessage);
      compactWriteBacklog();
      return;
    }

    writeQueue.push({ message: boundedMessage, streamKey, deltaBytes });
    if (streamKey !== undefined) {
      queuedStreamEvents += 1;
      queuedStreamBytes += deltaBytes;
      compactWriteBacklog();
    }
  }

  function compactWriteBacklog(): void {
    // Control/lifecycle messages are never compacted. Under pressure, only
    // stream deltas may be discarded; contiguous deltas are merged first.
    while (queuedStreamEvents > maxWriteBacklogEvents || queuedStreamBytes > maxWriteBacklogBytes) {
      const oldestStreamIndex = writeQueue.findIndex(
        (queuedMessage) => queuedMessage.streamKey !== undefined,
      );
      if (oldestStreamIndex < 0) {
        return;
      }
      const [removedMessage] = writeQueue.splice(oldestStreamIndex, 1);
      if (!removedMessage || removedMessage.streamKey === undefined) {
        continue;
      }
      queuedStreamEvents -= 1;
      queuedStreamBytes -= removedMessage.deltaBytes;
    }
  }

  function startWritePump(): void {
    if (writePumpRunning) {
      return;
    }
    writePumpRunning = true;
    void runWritePump();
  }

  async function runWritePump(): Promise<void> {
    try {
      while (writeQueue.length > 0) {
        const queuedMessage = writeQueue.shift();
        if (!queuedMessage) {
          continue;
        }
        if (queuedMessage.streamKey !== undefined) {
          queuedStreamEvents -= 1;
          queuedStreamBytes -= queuedMessage.deltaBytes;
        }
        try {
          await options.write(queuedMessage.message);
        } catch (error: unknown) {
          // Continue draining so one failed write cannot strand lifecycle or
          // terminal messages behind it. flush() still reports the failure.
          writeError = error;
        }
      }
    } finally {
      writePumpRunning = false;
      if (writeQueue.length > 0) {
        startWritePump();
      } else {
        const pendingError = writeError;
        writeError = null;
        for (const waiter of drainWaiters.splice(0)) {
          if (pendingError !== null) {
            waiter.reject(pendingError);
          } else {
            waiter.resolve();
          }
        }
      }
    }
  }

  function waitForDrain(): Promise<void> {
    if (!writePumpRunning && writeQueue.length === 0) {
      if (writeError !== null) {
        const error = writeError;
        writeError = null;
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      drainWaiters.push({ resolve, reject });
    });
  }

  function clearFlushTimer(): void {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
  }

  function scheduleFlush(): void {
    if (flushTimer !== undefined) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      enqueueWrite(takePendingDeltas());
    }, flushIntervalMs);
    flushTimer.unref?.();
  }

  function push(message: HostPush): void {
    if (message.type !== 'event' || !isStreamDeltaEvent(message.event)) {
      clearFlushTimer();
      enqueueWrite([...takePendingDeltas(), message]);
      return;
    }

    const key = buildDeltaKey(message.sessionId, message.event);
    const lastPendingDelta = pendingDeltas[pendingDeltas.length - 1];
    if (lastPendingDelta?.key === key) {
      const mergedEvent = mergeStreamDelta(lastPendingDelta.message.event, message.event);
      const boundedEvent = limitStreamDelta(mergedEvent, maxPendingDeltaBytes);
      lastPendingDelta.message = {
        ...lastPendingDelta.message,
        event: boundedEvent,
      };
      lastPendingDelta.deltaBytes = getDeltaBytes(lastPendingDelta.message);
    } else {
      if (
        pendingDeltas.length >= maxPendingDeltaEvents ||
        getPendingDeltaBytes() + getDeltaBytes(message) > maxPendingDeltaBytes
      ) {
        enqueueWrite(takePendingDeltas());
      }
      const boundedMessage = limitStreamPush(message, maxPendingDeltaBytes);
      pendingDeltas.push({
        key,
        message: boundedMessage,
        deltaBytes: getDeltaBytes(boundedMessage),
      });
    }
    scheduleFlush();
  }

  async function flush(): Promise<void> {
    clearFlushTimer();
    enqueueWrite(takePendingDeltas());
    await waitForDrain();
  }

  return { push, flush };

  function getPendingDeltaBytes(): number {
    return pendingDeltas.reduce(
      (totalBytes, pendingDelta) => totalBytes + pendingDelta.deltaBytes,
      0,
    );
  }
}

function validatePositiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function isStreamDeltaEvent(event: AgentEvent): event is StreamDeltaEvent {
  return (
    event.type === 'message/text_delta' ||
    event.type === 'message/thinking_delta' ||
    event.type === 'tool/update'
  );
}

function buildDeltaKey(sessionId: string, event: StreamDeltaEvent): string {
  switch (event.type) {
    case 'message/text_delta':
      return `${sessionId}:text:${event.messageId}`;
    case 'message/thinking_delta':
      return `${sessionId}:thinking:${event.messageId}`;
    case 'tool/update':
      return `${sessionId}:tool:${event.toolCallId}`;
  }
}

function getStreamKey(message: HostPush): string | undefined {
  if (message.type !== 'event' || !isStreamDeltaEvent(message.event)) {
    return undefined;
  }
  return buildDeltaKey(message.sessionId, message.event);
}

function getDeltaBytes(message: HostPush): number {
  if (message.type !== 'event' || !isStreamDeltaEvent(message.event)) {
    return 0;
  }
  return Buffer.byteLength(message.event.delta, 'utf8');
}

function limitStreamPush(message: StreamEventPush, maxBytes: number): StreamEventPush;
function limitStreamPush(message: HostPush, maxBytes: number): HostPush;
function limitStreamPush(message: HostPush, maxBytes: number): HostPush {
  if (message.type !== 'event') {
    return message;
  }
  if (!isStreamDeltaEvent(message.event)) {
    return message;
  }
  return {
    ...message,
    event: limitStreamDelta(message.event, maxBytes),
  };
}

function limitStreamDelta(event: StreamDeltaEvent, maxBytes: number): StreamDeltaEvent {
  if (getEventDeltaBytes(event) <= maxBytes) {
    return event;
  }
  const boundedDelta = Buffer.from(event.delta, 'utf8').subarray(0, maxBytes).toString('utf8');
  return { ...event, delta: boundedDelta };
}

function getEventDeltaBytes(event: StreamDeltaEvent): number {
  return Buffer.byteLength(event.delta, 'utf8');
}

function mergeStreamMessages(existing: HostPush, next: HostPush): HostPush {
  if (
    existing.type !== 'event' ||
    next.type !== 'event' ||
    !isStreamDeltaEvent(existing.event) ||
    !isStreamDeltaEvent(next.event)
  ) {
    return next;
  }
  return { ...existing, event: mergeStreamDelta(existing.event, next.event) };
}

function mergeStreamDelta(existing: AgentEvent, next: StreamDeltaEvent): StreamDeltaEvent {
  if (existing.type !== next.type) {
    return next;
  }
  if (existing.type === 'message/text_delta' && next.type === 'message/text_delta') {
    return { ...existing, delta: existing.delta + next.delta };
  }
  if (existing.type === 'message/thinking_delta' && next.type === 'message/thinking_delta') {
    return { ...existing, delta: existing.delta + next.delta };
  }
  if (existing.type === 'tool/update' && next.type === 'tool/update') {
    return { ...existing, delta: existing.delta + next.delta };
  }
  return next;
}
