import type { TranscriptState } from './transcript-model.js';

export type RewindItem = { id: string; text: string; label: string; description: string };

const LABEL_CHARS = 60;

/** The prompts on screen, newest first: each is a point the conversation can be rewritten from. */
export function listRewindItems(transcript: TranscriptState): RewindItem[] {
  const items: RewindItem[] = [];
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind !== 'message' || entry.role !== 'user') continue;
    const oneLine = entry.text.replace(/\s+/g, ' ').trim();
    const position = items.length;
    items.push({
      id: entry.id,
      text: entry.text,
      label: oneLine.length > LABEL_CHARS ? `${oneLine.slice(0, LABEL_CHARS)}…` : oneLine,
      description: position === 0 ? '最近一条' : `往前 ${position} 条`,
    });
  }
  return items;
}
