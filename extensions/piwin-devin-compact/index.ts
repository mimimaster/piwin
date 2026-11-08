import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveCompactRoot, writeHistoryFile } from './archive.js';
import { findSkillBlocks, findTodoBlock } from './preserve.js';
import { renderReplacementMessage } from './replacement.js';
import {
  createCompactState,
  extractEditedPathFromToolEnd,
  mergePreparationFileOps,
  recordEditedFiles,
} from './state.js';
import type { CompactState } from './state.js';
import { summarizeWithModel } from './summarize.js';
import type { ModelCompleter } from './summarize.js';
import { elideTranscript, renderMessages, toRenderedMessage } from './transcript.js';
import type { RenderedMessage } from './transcript.js';
import { asArray, asLoose, asNumber, asString } from './values.js';

export * from './archive.js';
export * from './preserve.js';
export * from './prompt.js';
export * from './replacement.js';
export * from './state.js';
export * from './summarize.js';
export * from './transcript.js';

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'boolean' | 'number';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
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
    options: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void },
  ) => void;
  on?: (event: string, handler: (...args: unknown[]) => unknown) => void;
};

export const COMPACT_BUSY_MESSAGE =
  'Cannot compact while the agent is working. Finish the current step first; prompts sent during compaction are queued automatically.';

type CompactContext = {
  cwd?: string;
  model?: unknown;
  modelRegistry?: {
    complete?: (model: unknown, context: unknown, options: unknown) => Promise<unknown>;
  };
  compact?: (options?: {
    customInstructions?: string;
    onComplete?: (result: unknown) => void;
    onError?: (error: Error) => void;
  }) => void;
  getContextUsage?: () =>
    | { tokens?: number | null; contextWindow?: number; percent?: number | null }
    | undefined;
  isIdle?: () => boolean;
  waitForIdle?: () => Promise<void>;
  ui?: { notify?: (message: string, type?: 'info' | 'warning' | 'error') => void };
};

const COMPACT_TOOL_PARAMETERS: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    focus: {
      type: 'string',
      description: 'Optional extra focus appended as a fourth summarizer turn.',
    },
  },
};

function cwdFrom(event: unknown, ctx: unknown, fallback?: string): string {
  return asString(asLoose(ctx)?.cwd) ?? asString(asLoose(event)?.cwd) ?? fallback ?? process.cwd();
}

function isAborted(signal: unknown): boolean {
  return signal instanceof AbortSignal && signal.aborted;
}

async function appendCompactionLog(root: string, entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(root, { recursive: true });
    await appendFile(join(root, 'compactions.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Logging must never break a compaction.
  }
}

export default function compactExtension(pi: ExtensionApi): void {
  let state: CompactState | undefined;

  const currentState = (event?: unknown, ctx?: unknown): CompactState => {
    const cwd = cwdFrom(event, ctx, state?.cwd);
    if (!state || state.cwd !== cwd) state = createCompactState(cwd);
    return state;
  };

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
        'Compact context the Devin way: archive the full transcript, summarize it with the recovered Devin summarizer prompt, and replace history with the Devin continuation message. Call as the last action of a phase.',
      parameters: COMPACT_TOOL_PARAMETERS,
      execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
        const ctx = (asLoose(context) ?? {}) as CompactContext;
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
        ctx.compact({});
        return {
          content: [
            {
              type: 'text',
              text: `Compaction started.${usageNote} This turn will abort; the next turn continues from the Devin continuation message.`,
            },
          ],
          details: { compact: 'started' },
        };
      },
    });
  }

  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand('compact', {
      description: 'Force Devin-style conversation compaction (archive + model summary)',
      handler: async (args, rawCtx) => {
        const ctx = (asLoose(rawCtx) ?? {}) as CompactContext;
        const current = currentState(undefined, ctx);
        if (typeof ctx.compact !== 'function') {
          ctx.ui?.notify?.('Compaction is unavailable in this runtime mode.', 'warning');
          return;
        }
        if (typeof ctx.waitForIdle === 'function') {
          await ctx.waitForIdle();
        } else if (typeof ctx.isIdle === 'function' && !ctx.isIdle()) {
          ctx.ui?.notify?.(COMPACT_BUSY_MESSAGE, 'warning');
          return;
        }
        const focus = args.trim();
        if (focus) current.pendingFocus = focus;
        ctx.compact({});
      },
    });
  }

  if (typeof pi.on !== 'function') return;

  pi.on('session_start', (event, ctx) => {
    state = undefined;
    currentState(event, ctx);
  });

  pi.on('session_before_compact', async (event, rawCtx) => {
    const loose = asLoose(event);
    const preparation = asLoose(loose?.preparation);
    const dropped = [
      ...asArray(preparation?.messagesToSummarize),
      ...asArray(preparation?.turnPrefixMessages),
    ];
    if (dropped.length === 0) return;
    if (isAborted(loose?.signal)) return;
    const firstKeptEntryId = asString(preparation?.firstKeptEntryId);
    if (!firstKeptEntryId) return;

    const ctx = (asLoose(rawCtx) ?? {}) as CompactContext;
    const completer = ctx.modelRegistry;
    if (!completer?.complete || ctx.model === undefined) {
      ctx.ui?.notify?.('devin-compact: no model available, falling back to default compaction', 'warning');
      return;
    }

    const current = currentState(event, ctx);
    mergePreparationFileOps(current, preparation);

    const previousSummary = asString(preparation?.previousSummary);
    const rendered: RenderedMessage[] = [];
    if (previousSummary) rendered.push({ role: 'System', text: previousSummary });
    for (const message of dropped) {
      const entry = toRenderedMessage(message);
      if (entry) rendered.push(entry);
    }
    if (rendered.length === 0) return;

    // Devin writes the full transcript, then elides only what it sends to the model.
    const full = renderMessages(rendered);
    const elided = elideTranscript(rendered);
    const root = resolveCompactRoot();
    const archived = await writeHistoryFile(root, full);
    if (isAborted(loose?.signal)) return;

    const focus = current.pendingFocus;
    delete current.pendingFocus;

    const modelCompleter: ModelCompleter = {
      complete: (model, context, options) => completer.complete?.(model, context, options) ?? Promise.resolve({}),
    };

    let summary: string | undefined;
    try {
      summary = await summarizeWithModel(
        modelCompleter,
        ctx.model,
        {
          historyFileName: archived.fileName,
          transcript: elided.text,
          ...(focus ? { focus } : {}),
          ...(loose?.signal instanceof AbortSignal ? { signal: loose.signal } : {}),
        },
      );
    } catch (error) {
      ctx.ui?.notify?.(
        `devin-compact: summarizer failed (${error instanceof Error ? error.message : String(error)}), falling back to default compaction`,
        'warning',
      );
      return;
    }
    if (!summary) {
      ctx.ui?.notify?.('devin-compact: empty summary, falling back to default compaction', 'warning');
      return;
    }
    if (isAborted(loose?.signal)) return;

    const preservedBlocks = [findTodoBlock(dropped), ...findSkillBlocks(dropped)].filter(
      (block): block is string => typeof block === 'string',
    );
    const replacement = renderReplacementMessage({
      historyPath: archived.filePath,
      summary,
      editedPaths: current.editedFiles,
      preservedBlocks,
    });
    current.compactionCount += 1;
    current.lastHistoryFile = archived.filePath;

    return {
      compaction: {
        summary: replacement,
        firstKeptEntryId,
        tokensBefore: asNumber(preparation?.tokensBefore) ?? 0,
        details: {
          historyFile: archived.filePath,
          historyFileName: archived.fileName,
          omittedMessages: elided.omitted,
          editedFiles: [...current.editedFiles],
          preservedBlocks: preservedBlocks.length,
          source: 'devin-compact',
        },
      },
    };
  });

  pi.on('session_compact', async (event, rawCtx) => {
    const loose = asLoose(event);
    const details = asLoose(asLoose(loose?.compactionEntry)?.details);
    if (asString(details?.source) !== 'devin-compact') return;
    const current = currentState(event, rawCtx);
    const historyFile = asString(details?.historyFile);
    if (historyFile) current.lastHistoryFile = historyFile;
    await appendCompactionLog(resolveCompactRoot(), {
      ts: new Date().toISOString(),
      workspace: current.cwd,
      reason: asString(loose?.reason) ?? 'unknown',
      tokensBefore: asNumber(preparationTokens(loose)) ?? null,
      historyFile: historyFile ?? null,
      omittedMessages: asNumber(details?.omittedMessages) ?? 0,
      editedFiles: current.editedFiles.length,
    });
    const notify = asLoose(asLoose(rawCtx)?.ui)?.notify;
    if (typeof notify === 'function') {
      notify(
        historyFile
          ? `Context compacted — transcript archived to ${historyFile}`
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
}

function preparationTokens(event: Record<string, unknown> | undefined): unknown {
  return asLoose(event?.compactionEntry)?.tokensBefore;
}
