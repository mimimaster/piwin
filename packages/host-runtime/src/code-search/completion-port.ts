/**
 * Backend-neutral port for one round of the `code_search` search subagent loop.
 *
 * The loop only needs "given messages + tools, return text and tool calls".
 * Two backends implement it: an already-configured piwin model
 * (`backends/model-backend.ts`) and the opt-in Windsurf/Devin cloud
 * (`backends/windsurf-backend.ts`). The tool schemas are JSON-schema shaped
 * because that is what both the Devin contract and provider tool-calling use.
 */
import type { CodeSearchToolSchema } from './tool-schema.js';

/** A tool call requested by the subagent model. */
export type CodeSearchCompletionToolCall = {
  id: string;
  name: string;
  /** Parsed JSON arguments; `{}` when the provider returned unparseable JSON. */
  arguments: Record<string, unknown>;
  /** Raw argument string when parsing failed, kept for diagnostics. */
  rawArguments?: string;
};

/**
 * One round's conversation. There is no `system` role: the system prompt is a
 * separate field so it can map onto Anthropic's top-level `system`.
 */
export type CodeSearchCompletionMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls: readonly CodeSearchCompletionToolCall[];
    }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

export type CodeSearchCompletionRequest = {
  systemPrompt: string;
  messages: readonly CodeSearchCompletionMessage[];
  tools: readonly CodeSearchToolSchema[];
  timeoutMs: number;
  signal: AbortSignal;
};

export type CodeSearchCompletionResponse = {
  /** Assistant text; empty when the model only asked for tools. */
  text: string;
  toolCalls: readonly CodeSearchCompletionToolCall[];
};

/** One round of subagent reasoning. Must throw on transport failure. */
export type CodeSearchCompletionPort = (
  request: CodeSearchCompletionRequest,
) => Promise<CodeSearchCompletionResponse>;

/** Stable error for backend failures, so the tool can report a reason. */
export class CodeSearchCompletionError extends Error {
  readonly code: 'provider-request-failed' | 'provider-timeout' | 'cancelled' | 'unsupported-protocol';

  constructor(code: CodeSearchCompletionError['code'], message: string) {
    super(message);
    this.name = 'CodeSearchCompletionError';
    this.code = code;
  }
}
