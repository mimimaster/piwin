/**
 * Devin-style context compaction for Pi (@piwin-bundled-extension).
 *
 * Mechanism recovered from the local Devin Desktop/CLI build (Devin 3.0.21,
 * crates `agent-ext/src/compactor/*` + Windsurf Cascade client) and ported to
 * Pi's native compaction pipeline:
 *
 * 1. History file — the full doomed conversation is written to
 *    `~/.piwin/compact/<session>/<timestamp>-<n>.md` before every compaction
 *    (Devin: "the full conversation will be saved to a history file"), and the
 *    summary points at it via message-id citations.
 * 2. Carry-over — edited/written files survive compaction (Devin's
 *    `compact/edited_files` carrier: "apply_summary: preserving N edited file
 *    path(s)") and are re-injected into the next LLM context.
 * 3. Devin summarizer shape — the exact `<summary>` structure (Overview /
 *    Key Details & Breadcrumbs / Current State), full summary every time,
 *    never diffs, never re-reciting rules, is passed to Pi's native
 *    summarizer as custom instructions.
 * 4. Events + logging — `CompactionStarted`/`Compacted`/`CompactionFailed`
 *    map onto Pi's `session_before_compact` / `session_compact` hooks plus a
 *    JSONL log (Devin's `post_compaction` hook example logs to a file).
 * 5. Busy guard — Devin rejects a forced compact while the agent is working
 *    ("Cannot compact while the agent is working"); prompts typed during
 *    compaction are queued by Pi natively.
 *
 * Threshold semantics: Devin's `agent.compaction_threshold_tokens` maps to
 * Pi's native `CompactionSettings` (`reserveTokens` / `keepRecentTokens` in
 * settings.jsonl); piwin surfaces enablement via pi-compaction-settings.
 *
 * Loaded by Pi jiti as a product extension under ~/.piwin/extensions.
 * Disable via config.extensions.disabledIds: ["compact"].
 */

import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'boolean' | 'number';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  minLength?: number;
};

export type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: JsonSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    context?: unknown,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

export type ExtensionApi = {
  registerTool?: (tool: RegisteredTool) => void;
  registerCommand?: (command: {
    name: string;
    description: string;
    callback: (args: string, ctx: unknown) => Promise<void> | void;
  }) => void;
  on?: (event: string, handler: (...args: unknown[]) => unknown) => void;
};

/** Loosely-typed view over Pi runtime objects (no Pi imports in bundled extensions). */
type Loose = Record<string, unknown>;

function asLoose(value: unknown): Loose | undefined {
  return typeof value === 'object' && value !== null ? (value as Loose) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars / 2);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n…[truncated ${text.length - maxChars} chars]…\n${text.slice(-tail)}`;
}

/* ------------------------------------------------------------------ *
 * Devin summarizer instructions (recovered from Devin 3.0.21 binary) *
 * ------------------------------------------------------------------ */

/**
 * Passed to Pi's native summarizer as `customInstructions`. Pi appends these
 * to its default summarization prompt; this is the Devin structure verbatim.
 */
export const DEVIN_SUMMARY_INSTRUCTIONS = `Structure the summary exactly as follows:

<summary>
## Overview
A high-level summary of what was being worked on and the overall goal (1-2 sentences).

## Key Details & Breadcrumbs
Important details that may be needed later (key findings, decisions, constraints, error messages, progress or modified files, etc).
For each item, note:
- What it is and why it matters
- If it would be helpful to look at the original source, include citations to message ids or search terms to find the details in the history file

## Current State
What the agent was actively working on when this summary was created:
- The immediate task or step in progress
- Any pending actions or next steps that were planned
- Blockers or questions that need resolution
</summary>

Rules:
- Output the full summary every time — do not output diffs, partial updates, or instructions.
- Do NOT reproduce or recite any rules, instructions, or guidelines that were included verbatim in the conversation (e.g., content inside <rules> or <rule> tags). Rules are re-discovered and re-injected as needed when the agent accesses relevant files.
- Be concise, but ensure someone could resume work using only your summary.`;

/** Devin rejects a forced compaction while the agent is mid-turn. */
export const COMPACT_BUSY_MESSAGE =
  'Cannot compact while the agent is working. Finish the current step first; prompts sent during compaction are queued automatically.';

/* ------------------------------------------------------------------ *
 * Paths                                                               *
 * ------------------------------------------------------------------ */

export function resolveCompactRoot(customRoot?: string): string {
  if (customRoot) return customRoot;
  const fromEnv = process.env.PIWIN_ROOT?.trim();
  if (fromEnv) return join(fromEnv, 'compact');
  return join(homedir(), '.piwin', 'compact');
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'session'
  );
}

export function sessionDirFor(cwd: string, root?: string): string {
  const digest = createHash('sha256').update(cwd).digest('hex').slice(0, 8);
  return join(resolveCompactRoot(root), `${slugify(cwd)}-${digest}`);
}

export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/* ------------------------------------------------------------------ *
 * Transcript rendering (the history file)                             *
 * ------------------------------------------------------------------ */

export type TranscriptMessage = {
  role: string;
  text: string;
  toolCalls: Array<{ id: string; name: string; argsText: string }>;
};

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of asArray(content)) {
    const loose = asLoose(block);
    const type = asString(loose?.type);
    if (type === 'text') {
      const text = asString(loose?.text);
      if (text) parts.push(text);
    } else if (type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n');
}

function contentToToolCalls(content: unknown): TranscriptMessage['toolCalls'] {
  const calls: TranscriptMessage['toolCalls'] = [];
  for (const block of asArray(content)) {
    const loose = asLoose(block);
    if (asString(loose?.type) !== 'tool_use' && asString(loose?.type) !== 'toolCall') continue;
    const name = asString(loose?.name) ?? 'tool';
    const id = asString(loose?.id) ?? '';
    let argsText = '';
    try {
      argsText = JSON.stringify(loose?.input ?? loose?.arguments ?? {});
    } catch {
      argsText = '[unserializable]';
    }
    calls.push({ id, name, argsText: truncateMiddle(argsText, 1200) });
  }
  return calls;
}

/** Normalize one loosely-typed Pi message into transcript form. */
export function toTranscriptMessage(message: unknown): TranscriptMessage {
  const loose = asLoose(message);
  const role = asString(loose?.role) ?? 'unknown';
  return {
    role,
    text: truncateMiddle(contentToText(loose?.content), 8000),
    toolCalls: contentToToolCalls(loose?.content),
  };
}

export type TranscriptMeta = {
  cwd: string;
  tokensBefore?: number;
  isSplitTurn?: boolean;
  previousSummary?: string;
  createdAt: Date;
};

/**
 * Render the doomed conversation as a markdown history file. Message ids
 * (`[m3]`, `[m3.t1]`) are the citations the Devin-style summary refers to.
 */
export function renderTranscriptMarkdown(
  messages: readonly unknown[],
  meta: TranscriptMeta,
): string {
  const lines: string[] = [];
  lines.push('# Compacted conversation transcript');
  lines.push('');
  lines.push(`- workspace: ${meta.cwd}`);
  lines.push(`- compacted at: ${meta.createdAt.toISOString()}`);
  if (meta.tokensBefore !== undefined) {
    lines.push(`- tokens before compaction: ${meta.tokensBefore}`);
  }
  lines.push(`- split turn: ${meta.isSplitTurn ? 'yes' : 'no'}`);
  lines.push(`- messages archived: ${messages.length}`);
  lines.push('');
  if (meta.previousSummary && meta.previousSummary.trim().length > 0) {
    lines.push('## Previous summary (already compacted)');
    lines.push('');
    lines.push(truncateMiddle(meta.previousSummary, 20000));
    lines.push('');
  }
  lines.push('## Transcript');
  lines.push('');
  messages.forEach((message, index) => {
    const normalized = toTranscriptMessage(message);
    const id = `m${index + 1}`;
    lines.push(`### [${id}] ${normalized.role}`);
    if (normalized.text.trim().length > 0) {
      lines.push(normalized.text);
    }
    for (const call of normalized.toolCalls) {
      lines.push('');
      lines.push(`#### [${id}.${call.name}] ${call.name}${call.id ? ` (${call.id})` : ''}`);
      lines.push('```json');
      lines.push(call.argsText);
      lines.push('```');
    }
    lines.push('');
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Carry-over state (Devin compact/edited_files + todo list carriers)  *
 * ------------------------------------------------------------------ */

export type CompactState = {
  cwd: string;
  sessionDir: string;
  compactionCount: number;
  editedFiles: string[];
  lastHistoryFile?: string;
  lastTokensBefore?: number;
  lastCompactedAt?: string;
};

export const EDITED_FILES_LIMIT = 50;

export function createCompactState(cwd: string, root?: string): CompactState {
  return { cwd, sessionDir: sessionDirFor(cwd, root), compactionCount: 0, editedFiles: [] };
}

/** Devin: "apply_summary: preserving N edited file path(s)". */
export function recordEditedFiles(state: CompactState, paths: readonly string[]): number {
  for (const path of paths) {
    const trimmed = path.trim();
    if (trimmed.length === 0 || state.editedFiles.includes(trimmed)) continue;
    state.editedFiles.push(trimmed);
  }
  if (state.editedFiles.length > EDITED_FILES_LIMIT) {
    state.editedFiles.splice(0, state.editedFiles.length - EDITED_FILES_LIMIT);
  }
  return state.editedFiles.length;
}

/**
 * The block re-injected into the next LLM context after a compaction —
 * Devin's history-file pointer plus preserved edited-file list.
 */
export function renderCarryoverBlock(state: CompactState, maxPaths = 12): string {
  const lines: string[] = ['<compaction_carryover source="compact-extension">'];
  lines.push(
    'Earlier context was compacted. Continue from the summarized state; do not redo completed work.',
  );
  if (state.lastHistoryFile) {
    lines.push(`The full pre-compaction transcript is archived at: ${state.lastHistoryFile}`);
    lines.push(
      'Grep/read that file to recover exact commands, outputs, code, or message ids instead of re-running work.',
    );
  }
  if (state.editedFiles.length > 0) {
    const shown = state.editedFiles.slice(-maxPaths);
    lines.push('Files edited or written this session (re-read before editing again):');
    for (const path of shown) lines.push(`- ${path}`);
    if (state.editedFiles.length > shown.length) {
      lines.push(
        `- …and ${state.editedFiles.length - shown.length} more (see the archived transcript)`,
      );
    }
  }
  lines.push('</compaction_carryover>');
  return lines.join('\n');
}

/** One injection per compaction: only surface the block once. */
export function shouldInjectCarryover(state: CompactState, lastInjected?: string): boolean {
  if (!state.lastHistoryFile) return false;
  return lastInjected !== state.lastHistoryFile;
}

/* ------------------------------------------------------------------ *
 * History file + log persistence                                      *
 * ------------------------------------------------------------------ */

export async function writeHistoryFile(
  state: CompactState,
  messages: readonly unknown[],
  meta: Omit<TranscriptMeta, 'cwd' | 'createdAt'>,
  now: Date = new Date(),
): Promise<string> {
  const fullMeta: TranscriptMeta = { ...meta, cwd: state.cwd, createdAt: now };
  const filePath = join(
    state.sessionDir,
    `${formatTimestamp(now)}-${state.compactionCount + 1}.md`,
  );
  await mkdir(state.sessionDir, { recursive: true });
  await writeFile(filePath, renderTranscriptMarkdown(messages, fullMeta), 'utf8');
  return filePath;
}

export type CompactionLogRecord = {
  ts: string;
  workspace: string;
  reason?: string;
  fromExtension?: boolean;
  tokensBefore?: number;
  summaryChars: number;
  historyFile?: string;
  editedFiles: number;
};

export async function appendCompactionLog(
  state: CompactState,
  record: CompactionLogRecord,
): Promise<void> {
  await mkdir(state.sessionDir, { recursive: true });
  await appendFile(
    join(state.sessionDir, 'compaction-log.jsonl'),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
}

/* ------------------------------------------------------------------ *
 * File-op extraction helpers                                          *
 * ------------------------------------------------------------------ */

/** Pi edit/write tool inputs carry the path in `path`. */
export function extractEditedPathFromToolEnd(event: unknown): string | undefined {
  const loose = asLoose(event);
  const toolName = asString(loose?.toolName);
  if (toolName !== 'edit' && toolName !== 'write') return undefined;
  const input = asLoose(loose?.input) ?? asLoose(loose?.args);
  return asString(input?.path) ?? asString(input?.file_path);
}

function toPathList(value: unknown): string[] {
  const source: unknown[] = value instanceof Set ? [...value] : asArray(value);
  const paths: string[] = [];
  for (const entry of source) {
    const path = asString(entry);
    if (path) paths.push(path);
  }
  return paths;
}

/** Merge a compaction preparation's fileOps (Devin: fileOps.read/written/edited are Sets). */
export function mergePreparationFileOps(state: CompactState, preparation: unknown): void {
  const loose = asLoose(preparation);
  const fileOps = asLoose(loose?.fileOps);
  if (!fileOps) return;
  const paths = [...toPathList(fileOps.edited), ...toPathList(fileOps.written)];
  recordEditedFiles(state, paths);
}

/* ------------------------------------------------------------------ *
 * Extension factory                                                   *
 * ------------------------------------------------------------------ */

type CompactToolContext = {
  isIdle?: () => boolean;
  compact?: (options?: {
    customInstructions?: string;
    onComplete?: (result: unknown) => void;
    onError?: (error: Error) => void;
  }) => void;
  getContextUsage?: () =>
    { tokens?: number | null; contextWindow?: number; percent?: number | null } | undefined;
  ui?: { notify?: (message: string, type?: 'info' | 'warning' | 'error') => void };
};

const COMPACT_TOOL_PARAMETERS: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    focus: {
      type: 'string',
      description:
        'Optional custom focus for the summary (e.g. "preserve the API contract decisions"). Appended to the Devin-style summarizer instructions.',
    },
  },
};

function buildCustomInstructions(focus: string | undefined, state: CompactState): string {
  const parts = [DEVIN_SUMMARY_INSTRUCTIONS];
  const trimmed = focus?.trim();
  if (trimmed)
    parts.push(`\nAdditional focus requested by the agent: ${truncateMiddle(trimmed, 2000)}`);
  if (state.editedFiles.length > 0) {
    const paths = state.editedFiles.slice(-12).join(', ');
    parts.push(
      `\nFiles edited or written this session so far (list them under Key Details & Breadcrumbs): ${paths}`,
    );
  }
  return parts.join('\n');
}

async function triggerCompaction(
  ctx: CompactToolContext,
  customInstructions: string,
  signal?: AbortSignal,
): Promise<'completed' | 'failed' | 'unavailable' | 'aborted'> {
  if (typeof ctx.compact !== 'function') return 'unavailable';
  return new Promise<'completed' | 'failed' | 'aborted'>((resolve) => {
    let settled = false;
    const settle = (outcome: 'completed' | 'failed' | 'aborted') => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = () => settle('aborted');
    if (signal) {
      if (signal.aborted) {
        resolve('aborted');
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      ctx.compact?.({
        customInstructions,
        onComplete: () => settle('completed'),
        onError: () => settle('failed'),
      });
    } catch {
      settle('failed');
    }
  });
}

export default function compactExtension(pi: ExtensionApi): void {
  // Per-session state. Pi creates one extension instance per session runtime;
  // session_start rebinds it when a session is created, resumed, or reloaded.
  const counters = new Map<string, number>();
  let state: CompactState | undefined;
  let lastInjectedHistoryFile: string | undefined;

  const ensureState = (cwd: string): CompactState => {
    if (state && state.cwd === cwd) return state;
    const next = createCompactState(cwd);
    next.compactionCount = counters.get(next.sessionDir) ?? 0;
    state = next;
    lastInjectedHistoryFile = undefined;
    return next;
  };

  /** Session-cwd aware accessor: event cwd > bound session cwd > process cwd. */
  const currentState = (event?: unknown): CompactState =>
    ensureState(asString(asLoose(event)?.cwd) ?? state?.cwd ?? process.cwd());

  if (typeof pi.registerTool === 'function') {
    pi.registerTool({
      name: 'compact',
      label: 'Compact Context',
      promptSnippet:
        'Summarize and archive the conversation when context is nearly full or a phase ends.',
      promptGuidelines: [
        'Call `compact` after finishing a large exploration or work phase, or when context usage is high.',
        'The full pre-compaction transcript is archived to disk automatically; do not manually re-summarize the conversation.',
        'Do not call `compact` while tools from the current step are still running.',
      ],
      description:
        'Compact the conversation context: summarize the history in Devin’s <summary> structure (Overview / Key Details & Breadcrumbs / Current State), archive the full transcript to ~/.piwin/compact/, and preserve the edited-file list across the boundary. Use it proactively after big exploration phases or before starting a new task in the same session; never call it mid-step.',
      parameters: COMPACT_TOOL_PARAMETERS,
      execute: async (toolCallId, params, signal, _onUpdate, context) => {
        const current = currentState();
        const ctx = (asLoose(context) ?? {}) as CompactToolContext;
        const focus = asString(asLoose(params)?.focus);

        if (typeof ctx.isIdle === 'function' && !ctx.isIdle()) {
          return {
            content: [{ type: 'text', text: COMPACT_BUSY_MESSAGE }],
            details: { compact: 'rejected-busy' },
          };
        }
        if (typeof ctx.compact !== 'function') {
          return {
            content: [
              {
                type: 'text',
                text: 'Compaction is unavailable in this runtime mode (no compact action bound).',
              },
            ],
            details: { compact: 'unavailable' },
          };
        }

        const usage = typeof ctx.getContextUsage === 'function' ? ctx.getContextUsage() : undefined;
        const percent = asNumber(usage?.percent);
        const usageNote =
          percent !== undefined
            ? ` Context usage before compaction: ${percent}% of ${asNumber(usage?.contextWindow) ?? '?'} tokens.`
            : '';

        const outcome = await triggerCompaction(
          ctx,
          buildCustomInstructions(focus, current),
          signal ?? undefined,
        );
        if (outcome === 'aborted') {
          return {
            content: [{ type: 'text', text: 'Compaction aborted before completion.' }],
            details: { compact: 'aborted' },
          };
        }
        if (outcome === 'failed') {
          return {
            content: [
              {
                type: 'text',
                text: 'Compaction failed. The conversation was left untouched; retry after the current step settles.',
              },
            ],
            details: { compact: 'failed' },
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Compaction complete.${usageNote} Continue from the summarized state — the archived transcript and preserved edited-file list are re-injected into your context automatically.`,
            },
          ],
          details: { compact: 'completed' },
        };
      },
    });
  }

  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand({
      name: 'compact',
      description: 'Force conversation compaction (Devin-style summary + transcript archive)',
      callback: async (args, rawCtx) => {
        const ctx = (asLoose(rawCtx) ?? {}) as CompactToolContext & {
          waitForIdle?: () => Promise<void>;
        };
        const current = currentState();
        if (typeof ctx.waitForIdle === 'function') {
          await ctx.waitForIdle();
        }
        const outcome = await triggerCompaction(ctx, buildCustomInstructions(args, current));
        ctx.ui?.notify?.(
          outcome === 'completed'
            ? `Context compacted — transcript archived under ${current.sessionDir}`
            : `Compaction ${outcome}`,
          outcome === 'completed' ? 'info' : 'warning',
        );
      },
    });
  }

  if (typeof pi.on !== 'function') return;

  pi.on('session_start', (event) => {
    const cwd = asString(asLoose(event)?.cwd) ?? state?.cwd ?? process.cwd();
    state = undefined;
    lastInjectedHistoryFile = undefined;
    ensureState(cwd);
  });

  pi.on('session_before_compact', async (event) => {
    const loose = asLoose(event);
    const preparation = asLoose(loose?.preparation);
    const messages = asArray(preparation?.messagesToSummarize);
    if (messages.length === 0) return;

    const current = currentState(event);
    current.compactionCount += 1;
    counters.set(current.sessionDir, current.compactionCount);
    mergePreparationFileOps(current, preparation);

    const tokensBefore = asNumber(preparation?.tokensBefore);
    const previousSummary = asString(preparation?.previousSummary);
    const historyFile = await writeHistoryFile(current, messages, {
      isSplitTurn: preparation?.isSplitTurn === true,
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(previousSummary !== undefined ? { previousSummary } : {}),
    });
    current.lastHistoryFile = historyFile;
    if (tokensBefore !== undefined) current.lastTokensBefore = tokensBefore;
    current.lastCompactedAt = new Date().toISOString();
    // Native Pi summarization proceeds (LLM-backed); we only archive and carry over.
    return undefined;
  });

  pi.on('session_compact', async (event, rawCtx) => {
    const loose = asLoose(event);
    const entry = asLoose(loose?.compactionEntry);
    const current = currentState(event);
    const reason = asString(loose?.reason);
    const tokensBefore = asNumber(entry?.tokensBefore);
    await appendCompactionLog(current, {
      ts: new Date().toISOString(),
      workspace: current.cwd,
      fromExtension: loose?.fromExtension === true,
      summaryChars: (asString(entry?.summary) ?? '').length,
      editedFiles: current.editedFiles.length,
      ...(reason !== undefined ? { reason } : {}),
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(current.lastHistoryFile !== undefined ? { historyFile: current.lastHistoryFile } : {}),
    });
    const ui = asLoose(asLoose(rawCtx)?.ui);
    const notify = ui?.notify;
    if (typeof notify === 'function') {
      notify(
        current.lastHistoryFile
          ? `Context compacted — transcript archived to ${current.lastHistoryFile}`
          : 'Context compacted.',
        'info',
      );
    }
  });

  pi.on('tool_execution_end', (event) => {
    const path = extractEditedPathFromToolEnd(event);
    if (!path) return;
    recordEditedFiles(currentState(event), [path]);
  });

  pi.on('context', (event) => {
    const current = currentState(event);
    if (!shouldInjectCarryover(current, lastInjectedHistoryFile)) return;
    const loose = asLoose(event);
    const messages = asArray(loose?.messages);
    lastInjectedHistoryFile = current.lastHistoryFile;
    return {
      messages: [
        { role: 'user', content: [{ type: 'text', text: renderCarryoverBlock(current) }] },
        ...messages,
      ],
    };
  });
}
