import type { TranscriptState } from './transcript-model.js';

export type FindHit = {
  entryId: string;
  /** Who said it, or the tool whose command or output matched. */
  source: string;
  /** A one-line window around the first match. */
  snippet: string;
  /** Everything the hit belongs to, for reading it whole. */
  full: string;
};

const CONTEXT_CHARS = 28;
const MAX_HITS = 60;

/** Words of a query, lowercased; every one must appear in a hit. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Matches in the conversation on screen, newest first: messages, tool commands and tool output. */
export function findInTranscript(transcript: TranscriptState, query: string): FindHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const hits: FindHit[] = [];
  for (let index = transcript.entries.length - 1; index >= 0 && hits.length < MAX_HITS; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind !== 'message') continue;
    const tools = [...entry.tools].reverse().flatMap((tool) => {
      const command = tool.presentation?.command;
      const output = tool.presentation?.output?.text ?? tool.output;
      const full = [command === undefined ? undefined : `$ ${command}`, output].filter(Boolean).join('\n');
      return [{ source: `工具 ${tool.toolName}`, full }];
    });
    const candidates = [{ source: entry.role === 'user' ? '你' : '助手', full: entry.text }, ...tools];
    for (const candidate of candidates) {
      const lowered = candidate.full.toLowerCase();
      if (words.length === 0 || !words.every((word) => lowered.includes(word))) continue;
      hits.push({
        entryId: entry.id,
        source: candidate.source,
        snippet: windowAround(candidate.full, lowered.indexOf(words[0] ?? '')),
        full: candidate.full,
      });
    }
  }
  return hits.slice(0, MAX_HITS);
}

function windowAround(text: string, position: number): string {
  const start = Math.max(0, position - CONTEXT_CHARS);
  const slice = text.slice(start, position + CONTEXT_CHARS * 2).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${position + CONTEXT_CHARS * 2 < text.length ? '…' : ''}`;
}
