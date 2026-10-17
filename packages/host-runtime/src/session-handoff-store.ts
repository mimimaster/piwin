/**
 * Handoff summary storage: one Markdown file per handed-off session.
 * The summary lives with the new session so deleting it removes the summary.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPiwinSessionDir } from './paths.js';

export const SESSION_HANDOFF_FILENAME = 'handoff.md';

/** Larger than the 8k message-ref cap: the summary is the whole carried context. */
export const MAX_HANDOFF_SUMMARY_CHARS = 24_000;

export function getSessionHandoffPath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), SESSION_HANDOFF_FILENAME);
}

export async function writeSessionHandoffSummary(
  rootDir: string,
  sessionId: string,
  summary: string,
): Promise<void> {
  await writeFile(getSessionHandoffPath(rootDir, sessionId), summary, 'utf8');
}

export type StoredHandoffSummary = {
  summary: string;
  truncated: boolean;
};

/** Undefined when the session has no handoff summary. */
export async function readStoredHandoffSummary(
  rootDir: string,
  sessionId: string,
): Promise<StoredHandoffSummary | undefined> {
  try {
    const content = await readFile(getSessionHandoffPath(rootDir, sessionId), 'utf8');
    return {
      summary: content.slice(0, MAX_HANDOFF_SUMMARY_CHARS),
      truncated: content.length > MAX_HANDOFF_SUMMARY_CHARS,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Undefined when the session has no handoff summary. */
export async function readSessionHandoffSummary(
  rootDir: string,
  sessionId: string,
): Promise<string | undefined> {
  return (await readStoredHandoffSummary(rootDir, sessionId))?.summary;
}
