/**
 * Copy a session Model Visibility Ledger into a derived session.
 * Duplicate copies everything. Fork keeps only events that still have a
 * cloned user row or a retained run, bounded by the selected transcript cut.
 */
import { access } from 'node:fs/promises';
import {
  openModelContextStore,
  type ModelContextCopiedEvent,
  type ModelContextStore,
} from './model-context-store.js';

export type ModelContextCopyRetain = {
  sourceMessageIds: ReadonlySet<string>;
  runIds: ReadonlySet<string>;
};

export type ModelContextCopyInput = {
  sourceDbPath: string;
  sourceSessionId: string;
  targetDbPath: string;
  targetSessionId: string;
  messageIdMap: ReadonlyMap<string, string>;
  retain?: ModelContextCopyRetain;
  /** Copy only source ledger events at or before this sequence. */
  maxSeq?: number;
  /** Resolve the inclusive ledger boundary from a copied source user row. */
  boundarySourceMessageId?: string;
  /** Fallback boundary for legacy events without a userMessageId. */
  boundaryCreatedAt?: string;
};

export type ModelContextStoreCopyOptions = {
  /** Copy only source ledger events at or before this sequence. */
  maxSeq?: number;
};

export type ModelContextCopyResult = {
  copiedEvents: number;
  copiedBlobs: number;
};

const BLOB_DIGEST = /^sha256:[a-f0-9]{64}$/i;

/** Copy an already-open ledger, preserving event ids and event metadata. */
export async function copyModelContextStore(
  source: ModelContextStore,
  target: ModelContextStore,
  options: ModelContextStoreCopyOptions = {},
): Promise<ModelContextCopyResult> {
  const events = await source.listEvents();
  const bounded = boundEvents(events, options.maxSeq);
  return copyEvents(source, target, bounded, {
    copyAllBlobs: options.maxSeq === undefined,
    coverage: await source.getCoverage(),
  });
}

export async function copyModelContextLedger(
  input: ModelContextCopyInput,
): Promise<ModelContextCopyResult> {
  try {
    await access(input.sourceDbPath);
  } catch {
    return { copiedEvents: 0, copiedBlobs: 0 };
  }

  const source = await openModelContextStore({
    dbPath: input.sourceDbPath,
    sessionId: input.sourceSessionId,
  });
  const target = await openModelContextStore({
    dbPath: input.targetDbPath,
    sessionId: input.targetSessionId,
  });
  try {
    const events = await source.listEvents();
    const maxSeq = resolveBoundarySeq(events, input);
    const bounded = boundEvents(events, maxSeq);
    const kept = bounded.filter((event) => shouldRetainEvent(event, input.retain));
    const rewritten = kept.map((event) => rewriteCopiedEvent(event, input));
    return await copyEvents(source, target, rewritten, {
      copyAllBlobs: input.retain === undefined,
      coverage: await source.getCoverage(),
    });
  } finally {
    source.close();
    target.close();
  }
}

async function copyEvents(
  source: ModelContextStore,
  target: ModelContextStore,
  events: readonly ModelContextCopiedEvent[],
  options: {
    copyAllBlobs: boolean;
    coverage: Awaited<ReturnType<ModelContextStore['getCoverage']>>;
  },
): Promise<ModelContextCopyResult> {
  const copiedEvents = [...events];
  const neededDigests = collectBlobDigests(copiedEvents);
  const blobs = await source.listBlobs();
  let copiedBlobs = 0;
  for (const blob of blobs) {
    if (!options.copyAllBlobs && !neededDigests.has(blob.digest)) continue;
    await target.putBlob({ mediaType: blob.mediaType, body: blob.body });
    copiedBlobs += 1;
  }
  for (const event of copiedEvents) {
    await target.appendEvent({
      eventId: event.eventId,
      type: event.type,
      payload: event.payload,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.runtimeGenerationId === undefined
        ? {}
        : { runtimeGenerationId: event.runtimeGenerationId }),
      ...(event.requestClass === undefined ? {} : { requestClass: event.requestClass }),
      ...(event.requestOrdinal === undefined ? {} : { requestOrdinal: event.requestOrdinal }),
      ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
      createdAt: event.createdAt,
      ...(event.blobDigests === undefined ? {} : { blobDigests: event.blobDigests }),
    });
  }
  await target.setCoverage(options.coverage);
  return { copiedEvents: copiedEvents.length, copiedBlobs };
}

function resolveBoundarySeq(
  events: readonly ModelContextCopiedEvent[],
  input: ModelContextCopyInput,
): number | undefined {
  if (input.maxSeq !== undefined) return input.maxSeq;
  if (input.boundarySourceMessageId !== undefined) {
    const matching = events.filter(
      (event) => readUserMessageId(event.payload) === input.boundarySourceMessageId,
    );
    const last = matching.at(-1);
    if (last !== undefined) {
      const nextGeneration = events.find(
        (event) => event.type === 'generation/open' && event.seq > last.seq,
      );
      return nextGeneration === undefined ? events.at(-1)?.seq : nextGeneration.seq - 1;
    }
  }
  if (input.boundaryCreatedAt !== undefined) {
    const boundaryCreatedAt = input.boundaryCreatedAt;
    const matching = events.filter((event) => event.createdAt <= boundaryCreatedAt);
    const last = matching.at(-1);
    if (last !== undefined) return last.seq;
  }
  return undefined;
}

function boundEvents(
  events: readonly ModelContextCopiedEvent[],
  maxSeq: number | undefined,
): ModelContextCopiedEvent[] {
  if (maxSeq === undefined) return [...events];
  return events.filter((event) => event.seq <= maxSeq);
}

function shouldRetainEvent(
  event: ModelContextCopiedEvent,
  retain: ModelContextCopyRetain | undefined,
): boolean {
  if (retain === undefined) return true;
  if (event.runId !== undefined && retain.runIds.has(event.runId)) return true;
  const userMessageId = readUserMessageId(event.payload);
  return userMessageId !== undefined && retain.sourceMessageIds.has(userMessageId);
}

function rewriteCopiedEvent(
  event: ModelContextCopiedEvent,
  input: ModelContextCopyInput,
): ModelContextCopiedEvent {
  return {
    ...event,
    payload: rewritePayload(event.payload, input),
  };
}

function rewritePayload(payload: unknown, input: ModelContextCopyInput): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const next: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  if (typeof next.sessionId === 'string') {
    next.sessionId = input.targetSessionId;
  }
  if (typeof next.userMessageId === 'string') {
    const mapped = input.messageIdMap.get(next.userMessageId);
    if (mapped !== undefined) next.userMessageId = mapped;
  }
  return next;
}

function readUserMessageId(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const userMessageId = (payload as { userMessageId?: unknown }).userMessageId;
  return typeof userMessageId === 'string' && userMessageId.length > 0 ? userMessageId : undefined;
}

function collectBlobDigests(events: readonly ModelContextCopiedEvent[]): Set<string> {
  const digests = new Set<string>();
  for (const event of events) {
    for (const digest of event.blobDigests ?? []) {
      if (BLOB_DIGEST.test(digest)) digests.add(digest.toLowerCase());
    }
    collectSummaryContentRefs(event.payload, digests);
  }
  return digests;
}

function collectSummaryContentRefs(payload: unknown, digests: Set<string>): void {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
  const contributions = (payload as { contributions?: unknown }).contributions;
  if (!Array.isArray(contributions)) return;
  for (const contribution of contributions) {
    if (contribution === null || typeof contribution !== 'object' || Array.isArray(contribution)) {
      continue;
    }
    const contentRef = (contribution as { contentRef?: unknown }).contentRef;
    if (contentRef === null || typeof contentRef !== 'object' || Array.isArray(contentRef)) {
      continue;
    }
    const digest = (contentRef as { digest?: unknown }).digest;
    if (typeof digest === 'string' && BLOB_DIGEST.test(digest)) {
      digests.add(digest.toLowerCase());
    }
  }
}
