/**
 * Devin-style context compaction for Pi (@piwin-bundled-extension).
 *
 * Recovered from Devin 3.0.21 (`agent-ext/src/compactor/*`) and applied to
 * every Pi compaction (manual /compact, the compact tool, threshold, overflow):
 *
 * 1. History file — doomed messages written to
 *    `~/.piwin/compact/<session>/<timestamp>-<n>.md` with `[mN]` citations.
 * 2. Devin `<summary>` — Overview / Key Details & Breadcrumbs / Current State.
 *    Returned from `session_before_compact` so auto-compact uses it too
 *    (Pi's native summarizer cannot take extension customInstructions).
 * 3. Carry-over — edited/written files survive (Devin `compact/edited_files`)
 *    and are re-injected once on the next `context` hook.
 * 4. Busy guard — user `/compact` waits for idle or rejects mid-turn
 *    ("Cannot compact while the agent is working"). The compact *tool* is
 *    called during a turn on purpose; it fires compaction and returns
 *    immediately because `ctx.compact()` aborts the current agent run.
 *
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
  registerCommand?: (
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: unknown) => Promise<void> | void;
    },
  ) => void;
  on?: (event: string, handler: (...args: unknown[]) => unknown) => void;
};

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

function oneLine(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}…`;
}

/** Devin summarizer shape — used both as the produced summary and as fallback instructions. */
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

/** Devin rejects a user-forced compact while the agent is mid-turn. */
export const COMPACT_BUSY_MESSAGE =
  'Cannot compact while the agent is working. Finish the current step first; prompts sent during compaction are queued automatically.';

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

export type CompactState = {
  cwd: string;
  sessionDir: string;
  compactionCount: number;
  editedFiles: string[];
  lastHistoryFile?: string;
  lastTokensBefore?: number;
  lastCompactedAt?: string;
  pendingFocus?: string;
};

export const EDITED_FILES_LIMIT = 50;

export function createCompactState(cwd: string, root?: string): CompactState {
  return { cwd, sessionDir: sessionDirFor(cwd, root), compactionCount: 0, editedFiles: [] };
}

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

export function shouldInjectCarryover(state: CompactState, lastInjected?: string): boolean {
  if (!state.lastHistoryFile) return false;
  return lastInjected !== state.lastHistoryFile;
}

/**
 * Devin `<summary>` built from the doomed transcript. Used as the compaction
 * entry so threshold/overflow compact (which cannot take customInstructions)
 * still get the Devin shape. Details live in the history file.
 */
export function renderDevinSummary(opts: {
  messages: readonly unknown[];
  historyFile?: string;
  editedFiles?: readonly string[];
  previousSummary?: string;
  tokensBefore?: number;
  focus?: string;
  isSplitTurn?: boolean;
}): string {
  const normalized = opts.messages.map((message, index) => ({
    id: `m${index + 1}`,
    ...toTranscriptMessage(message),
  }));
  const users = normalized.filter(
    (message) => message.role === 'user' && !message.text.includes('<compaction_carryover'),
  );
  const lastUser = users.at(-1);
  const lastAssistant = [...normalized].reverse().find((message) => message.role === 'assistant');
  const tools = normalized.flatMap((message) =>
    message.toolCalls.map((call) => ({ mid: message.id, ...call })),
  );
  const errorLines: string[] = [];
  for (const message of normalized) {
    if (message.role !== 'toolResult' && message.role !== 'tool') continue;
    const text = message.text.trim();
    if (/error|failed|exception|traceback/i.test(text)) {
      errorLines.push(`- [${message.id}] ${oneLine(text, 220)}`);
    }
  }

  const overviewParts: string[] = [];
  if (lastUser?.text) overviewParts.push(oneLine(lastUser.text, 280));
  else if (opts.previousSummary) overviewParts.push(oneLine(opts.previousSummary, 280));
  if (overviewParts.length === 0) overviewParts.push('Session context compacted.');

  const breadcrumbs: string[] = [];
  if (opts.historyFile) {
    breadcrumbs.push(`- Full pre-compaction transcript (grep [mN] citations): ${opts.historyFile}`);
  }
  if (opts.tokensBefore !== undefined) {
    breadcrumbs.push(`- Tokens before compaction: ${opts.tokensBefore}`);
  }
  const edited = opts.editedFiles ?? [];
  if (edited.length > 0) {
    breadcrumbs.push(
      `- Edited/written files (re-read before editing): ${edited.slice(-12).join(', ')}`,
    );
  }
  if (tools.length > 0) {
    const shown = tools.slice(-8);
    breadcrumbs.push(
      `- Tools used: ${shown.map((call) => `${call.name} [${call.mid}]`).join(', ')}`,
    );
  }
  if (errorLines.length > 0) {
    breadcrumbs.push('- Errors / failures:');
    breadcrumbs.push(...errorLines.slice(-6));
  }
  if (opts.focus?.trim()) {
    breadcrumbs.push(`- Requested focus: ${oneLine(opts.focus, 400)}`);
  }
  if (opts.previousSummary?.trim()) {
    breadcrumbs.push(`- Previous summary: ${oneLine(opts.previousSummary, 400)}`);
  }
  if (breadcrumbs.length === 0) breadcrumbs.push('- (none)');

  const current: string[] = [];
  if (lastUser)
    current.push(`- Last user request [${lastUser.id}]: ${oneLine(lastUser.text, 280)}`);
  if (lastAssistant) {
    current.push(
      `- Last assistant step [${lastAssistant.id}]: ${oneLine(lastAssistant.text || lastAssistant.toolCalls.map((c) => c.name).join(', ') || '(tool calls)', 280)}`,
    );
  }
  if (opts.isSplitTurn)
    current.push('- Compaction split a turn in progress; resume the interrupted step.');
  current.push('- Next: continue from this summary; do not redo completed work.');

  return [
    '<summary>',
    '## Overview',
    overviewParts.join(' '),
    '',
    '## Key Details & Breadcrumbs',
    ...breadcrumbs,
    '',
    '## Current State',
    ...current,
    '</summary>',
  ].join('\n');
}

export async function writeHistoryFile(
  state: CompactState,
  messages: readonly unknown[],
  meta: Omit<TranscriptMeta, 'cwd' | 'createdAt'>,
  now: Date = new Date(),
): Promise<string> {
  const fullMeta: TranscriptMeta = { ...meta, cwd: state.cwd, createdAt: now };
  const seq = Math.max(1, state.compactionCount);
  const filePath = join(state.sessionDir, `${formatTimestamp(now)}-${seq}.md`);
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

export function mergePreparationFileOps(state: CompactState, preparation: unknown): void {
  const loose = asLoose(preparation);
  const fileOps = asLoose(loose?.fileOps);
  if (!fileOps) return;
  recordEditedFiles(state, [...toPathList(fileOps.edited), ...toPathList(fileOps.written)]);
}

type CompactToolContext = {
  cwd?: string;
  isIdle?: () => boolean;
  compact?: (options?: {
    customInstructions?: string;
    onComplete?: (result: unknown) => void;
    onError?: (error: Error) => void;
  }) => void;
  getContextUsage?: () =>
    { tokens?: number | null; contextWindow?: number; percent?: number | null } | undefined;
  ui?: { notify?: (message: string, type?: 'info' | 'warning' | 'error') => void };
  waitForIdle?: () => Promise<void>;
};

const COMPACT_TOOL_PARAMETERS: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    focus: {
      type: 'string',
      description:
        'Optional custom focus for the summary (e.g. "preserve the API contract decisions"). Folded into Key Details & Breadcrumbs.',
    },
  },
};

function buildCustomInstructions(focus: string | undefined, state: CompactState): string {
  const parts = [DEVIN_SUMMARY_INSTRUCTIONS];
  const trimmed = focus?.trim();
  if (trimmed) {
    parts.push(`\nAdditional focus requested by the agent: ${truncateMiddle(trimmed, 2000)}`);
  }
  if (state.editedFiles.length > 0) {
    parts.push(
      `\nFiles edited or written this session so far (list them under Key Details & Breadcrumbs): ${state.editedFiles.slice(-12).join(', ')}`,
    );
  }
  if (state.lastHistoryFile) {
    parts.push(`\nCite the archived transcript at ${state.lastHistoryFile} with [mN] message ids.`);
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

function cwdFrom(event: unknown, ctx: unknown, fallback?: string): string {
  return asString(asLoose(ctx)?.cwd) ?? asString(asLoose(event)?.cwd) ?? fallback ?? process.cwd();
}

export default function compactExtension(pi: ExtensionApi): void {
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

  const currentState = (event?: unknown, ctx?: unknown): CompactState =>
    ensureState(cwdFrom(event, ctx, state?.cwd));

  if (typeof pi.registerTool === 'function') {
    pi.registerTool({
      name: 'compact',
      label: 'Compact Context',
      promptSnippet:
        'Summarize and archive the conversation when context is nearly full or a phase ends.',
      promptGuidelines: [
        'Call `compact` as the last action of a large exploration or work phase, or when context usage is high.',
        'Compaction aborts the current turn; the next turn continues from the Devin <summary> plus the archived transcript.',
        'Do not call `compact` in the middle of a step — finish the current tool batch first.',
      ],
      description:
        'Compact conversation context the Devin way: write the full transcript to ~/.piwin/compact/, replace history with a <summary> (Overview / Key Details & Breadcrumbs / Current State), and preserve edited files. Call as the last action of a phase. Compaction aborts this turn; continue from the summary on the next turn. Never call mid-step.',
      parameters: COMPACT_TOOL_PARAMETERS,
      execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
        const ctx = (asLoose(context) ?? {}) as CompactToolContext;
        const current = currentState(undefined, ctx);
        const focus = asString(asLoose(params)?.focus);
        if (focus) current.pendingFocus = focus;

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
            ? ` Context usage: ${percent}% of ${asNumber(usage?.contextWindow) ?? '?'} tokens.`
            : '';

        // Fire-and-forget: Pi's compact() aborts the current agent run (including this tool).
        ctx.compact({ customInstructions: buildCustomInstructions(focus, current) });
        return {
          content: [
            {
              type: 'text',
              text: `Compaction started.${usageNote} This turn will abort; the next turn continues from the Devin <summary>. The full transcript is archived under ${current.sessionDir}.`,
            },
          ],
          details: { compact: 'started' },
        };
      },
    });
  }

  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand('compact', {
      description: 'Force Devin-style conversation compaction (summary + transcript archive)',
      handler: async (args, rawCtx) => {
        const ctx = (asLoose(rawCtx) ?? {}) as CompactToolContext;
        const current = currentState(undefined, ctx);
        if (typeof ctx.waitForIdle === 'function') {
          await ctx.waitForIdle();
        } else if (typeof ctx.isIdle === 'function' && !ctx.isIdle()) {
          ctx.ui?.notify?.(COMPACT_BUSY_MESSAGE, 'warning');
          return;
        }
        const focus = args.trim();
        if (focus) current.pendingFocus = focus;
        const outcome = await triggerCompaction(
          ctx,
          buildCustomInstructions(focus || undefined, current),
        );
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

  pi.on('session_start', (event, ctx) => {
    state = undefined;
    lastInjectedHistoryFile = undefined;
    ensureState(cwdFrom(event, ctx));
  });

  pi.on('session_before_compact', async (event, ctx) => {
    const loose = asLoose(event);
    const preparation = asLoose(loose?.preparation);
    const messages = asArray(preparation?.messagesToSummarize);
    if (messages.length === 0) return;

    const current = currentState(event, ctx);
    current.compactionCount += 1;
    counters.set(current.sessionDir, current.compactionCount);
    mergePreparationFileOps(current, preparation);

    const tokensBefore = asNumber(preparation?.tokensBefore);
    const previousSummary = asString(preparation?.previousSummary);
    const isSplitTurn = preparation?.isSplitTurn === true;
    const historyFile = await writeHistoryFile(current, messages, {
      isSplitTurn,
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(previousSummary !== undefined ? { previousSummary } : {}),
    });
    current.lastHistoryFile = historyFile;
    if (tokensBefore !== undefined) current.lastTokensBefore = tokensBefore;
    current.lastCompactedAt = new Date().toISOString();

    const firstKeptEntryId = asString(preparation?.firstKeptEntryId);
    if (!firstKeptEntryId) return;

    const focus = current.pendingFocus;
    delete current.pendingFocus;
    const summary = renderDevinSummary({
      messages,
      historyFile,
      editedFiles: current.editedFiles,
      ...(previousSummary !== undefined ? { previousSummary } : {}),
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(focus !== undefined ? { focus } : {}),
      isSplitTurn,
    });
    return {
      compaction: {
        summary,
        firstKeptEntryId,
        tokensBefore: tokensBefore ?? 0,
        details: {
          historyFile,
          editedFiles: [...current.editedFiles],
          source: 'compact-extension',
        },
      },
    };
  });

  pi.on('session_compact', async (event, rawCtx) => {
    const loose = asLoose(event);
    const entry = asLoose(loose?.compactionEntry);
    const current = currentState(event, rawCtx);
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
    const notify = asLoose(asLoose(rawCtx)?.ui)?.notify;
    if (typeof notify === 'function') {
      notify(
        current.lastHistoryFile
          ? `Context compacted — transcript archived to ${current.lastHistoryFile}`
          : 'Context compacted.',
        'info',
      );
    }
  });

  pi.on('tool_execution_end', (event, ctx) => {
    const path = extractEditedPathFromToolEnd(event);
    if (!path) return;
    recordEditedFiles(currentState(event, ctx), [path]);
  });

  pi.on('context', (event, ctx) => {
    const current = currentState(event, ctx);
    if (!shouldInjectCarryover(current, lastInjectedHistoryFile)) return;
    const messages = asArray(asLoose(event)?.messages);
    lastInjectedHistoryFile = current.lastHistoryFile;
    return {
      messages: [
        { role: 'user', content: [{ type: 'text', text: renderCarryoverBlock(current) }] },
        ...messages,
      ],
    };
  });
}
