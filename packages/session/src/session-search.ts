/**
 * Product-layer session search over index projection + optional transcript scan.
 * W1: pure TS substring scoring (no better-sqlite3 dependency).
 */
import type {
  SessionIndexRecord,
  SessionSearchHit,
  SessionSearchQuery,
  SessionSearchResult,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { listAllSessionRecords } from './session-index-store.js';
import { listTranscriptMessages } from './message-store.js';

export type SessionSearchOptions = {
  indexPath: string;
  /** Resolve transcript.json path for a session id. When omitted, only index fields are searched. */
  resolveTranscriptPath?: (sessionId: string) => string;
  /** Max transcripts to open when scanning body text. Default 40. */
  maxTranscriptScans?: number;
};

export async function searchSessions(
  options: SessionSearchOptions,
  query: SessionSearchQuery,
): Promise<SessionSearchResult> {
  const rawQuery = query.query.trim();
  const normalizedQuery = rawQuery.toLowerCase();
  const limit = clampLimit(query.limit);
  const records = await listAllSessionRecords(options.indexPath, query.projectPath);
  const candidates = query.pinnedOnly
    ? records.filter((record) => record.isPinned === true)
    : records;

  if (!normalizedQuery) {
    return {
      query: rawQuery,
      hits: candidates.slice(0, limit).map((record) => indexHit(record, 0)),
    };
  }

  const hits: SessionSearchHit[] = [];
  let transcriptScans = 0;
  const maxScans = options.maxTranscriptScans ?? 40;

  for (const record of candidates) {
    const indexMatch = scoreIndexRecord(record, normalizedQuery);
    if (indexMatch) {
      hits.push(indexMatch);
      continue;
    }

    if (!options.resolveTranscriptPath || transcriptScans >= maxScans) {
      continue;
    }

    transcriptScans += 1;
    try {
      const messages = await listTranscriptMessages(
        options.resolveTranscriptPath(record.id),
      );
      const bodyHit = scoreTranscriptMessages(record, messages, normalizedQuery);
      if (bodyHit) {
        hits.push(bodyHit);
      }
    } catch {
      // best-effort transcript scan
    }
  }

  hits.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  return {
    query: rawQuery,
    hits: hits.slice(0, limit),
  };
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return 20;
  }
  return Math.min(Math.floor(limit), 100);
}

function indexHit(record: SessionIndexRecord, score: number): SessionSearchHit {
  const hit: SessionSearchHit = {
    sessionId: record.id,
    projectPath: record.projectPath,
    score,
  };
  if (record.name) hit.name = record.name;
  if (record.updatedAt) hit.updatedAt = record.updatedAt;
  if (record.isPinned === true) hit.isPinned = true;
  if (record.lastPreview) hit.snippet = record.lastPreview.slice(0, 160);
  return hit;
}

function scoreIndexRecord(
  record: SessionIndexRecord,
  normalizedQuery: string,
): SessionSearchHit | null {
  const fields: Array<{ text: string; weight: number; messageId?: string }> = [
    { text: record.name ?? '', weight: 3 },
    { text: record.lastPreview ?? '', weight: 2 },
    { text: record.summaryPreview ?? '', weight: 2 },
    { text: record.task ?? '', weight: 1.5 },
    { text: record.id, weight: 0.5 },
  ];

  let bestScore = 0;
  let bestSnippet: string | undefined;

  for (const field of fields) {
    const lower = field.text.toLowerCase();
    if (!lower.includes(normalizedQuery)) {
      continue;
    }
    const score = field.weight + matchDensityBonus(lower, normalizedQuery);
    if (score > bestScore) {
      bestScore = score;
      bestSnippet = snippetAround(field.text, normalizedQuery);
    }
  }

  if (bestScore <= 0) {
    return null;
  }

  const hit = indexHit(record, bestScore);
  if (bestSnippet) {
    hit.snippet = bestSnippet;
  }
  return hit;
}

function scoreTranscriptMessages(
  record: SessionIndexRecord,
  messages: SessionTranscriptMessage[],
  normalizedQuery: string,
): SessionSearchHit | null {
  let bestScore = 0;
  let bestSnippet: string | undefined;
  let bestMessageId: string | undefined;

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    const lower = message.text.toLowerCase();
    if (!lower.includes(normalizedQuery)) {
      continue;
    }
    const roleWeight = message.role === 'user' ? 1.8 : 1.2;
    const score = roleWeight + matchDensityBonus(lower, normalizedQuery);
    if (score > bestScore) {
      bestScore = score;
      bestSnippet = snippetAround(message.text, normalizedQuery);
      bestMessageId = message.id;
    }
  }

  if (bestScore <= 0) {
    return null;
  }

  const hit = indexHit(record, bestScore);
  if (bestSnippet) hit.snippet = bestSnippet;
  if (bestMessageId) hit.messageId = bestMessageId;
  return hit;
}

function matchDensityBonus(haystack: string, needle: string): number {
  if (haystack.startsWith(needle)) {
    return 0.5;
  }
  return 0;
}

function snippetAround(text: string, normalizedQuery: string, radius = 60): string {
  const lower = text.toLowerCase();
  const index = lower.indexOf(normalizedQuery);
  if (index === -1) {
    return text.slice(0, 160);
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + normalizedQuery.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}
