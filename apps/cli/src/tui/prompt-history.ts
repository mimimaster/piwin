import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 500;
/** A pasted document is not a prompt worth recalling; it would also bloat the file. */
const MAX_ENTRY_CHARS = 8_000;

/**
 * Prompts the person sent, oldest first, kept per project so Up-arrow and
 * Ctrl+R recall what was typed in that project. One JSON string per line; a
 * missing or unreadable file is an empty history, never an error that stops the
 * composer.
 */
export class PromptHistory {
  private entries: string[];

  /** Without a file the history lives for this run only. */
  public constructor(private readonly file: string | undefined) {
    this.entries = file === undefined ? [] : readEntries(file);
  }

  /** Oldest first, as `Editor.addToHistory` wants them. */
  public all(): readonly string[] {
    return this.entries;
  }

  public add(text: string): void {
    const entry = text.trim();
    if (entry.length === 0 || entry.length > MAX_ENTRY_CHARS || this.entries[this.entries.length - 1] === entry) return;
    this.entries.push(entry);
    if (this.file === undefined) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      if (this.entries.length > MAX_ENTRIES * 2) {
        // Trim by rewriting; appends in between would otherwise grow the file for ever.
        this.entries = this.entries.slice(-MAX_ENTRIES);
        writeFileSync(this.file, this.entries.map((line) => `${JSON.stringify(line)}\n`).join(''));
      } else {
        appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
      }
    } catch {
      // A history that cannot be saved still works for this run.
    }
  }

  /** Newest first. Every word of the query must appear, in any order, ignoring case. */
  public search(query: string): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches: string[] = [];
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index] ?? '';
      const lowered = entry.toLowerCase();
      if (words.every((word) => lowered.includes(word))) matches.push(entry);
    }
    return matches;
  }
}

function readEntries(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const entries: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'string' && value.length > 0) entries.push(value);
    } catch {
      // A torn last line from a killed process: skip it, keep the rest.
    }
  }
  return entries.slice(-MAX_ENTRIES);
}

/** Where a project's history lives under the product root. */
export function promptHistoryFile(piwinRoot: string, projectId: string | undefined): string {
  const scope = (projectId ?? 'general').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(piwinRoot, 'tui-history', `${scope}.jsonl`);
}
