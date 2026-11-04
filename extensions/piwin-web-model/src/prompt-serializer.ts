/**
 * Serialize a Pi `Context` into the single text blob typed into a model web page.
 *
 * Why a hand-rolled format: the web page has no notion of roles, tools or
 * streaming. Everything Pi knows must survive a round trip through plain text,
 * including the tool protocol the page model has to emit back.
 *
 * Two shapes, because one web conversation is bound to one Pi session:
 * - bootstrap (`includeBootstrap`): system prompt + tool catalog + protocol rules,
 *   sent once at the head of the web conversation.
 * - turn: only the messages that appeared since the last delivery.
 *
 * Invariants:
 * - Pure. No I/O, no clock, no randomness: the same Context always renders the
 *   same text, so a retry cannot silently change what the model saw.
 * - Every rendered block is delimited, so the page model never has to guess
 *   where a tool result ends and a new instruction begins.
 */

import type { Context, Message } from "@earendil-works/pi-ai";

/** Marker the reply parser keys on. Keep in sync with `reply-parser.ts`. */
export const TOOL_CALL_PREFIX = '{"type":"tool_call"';

export const TOOL_PROTOCOL = [
  "## Tool protocol",
  "You can call tools. To call one, reply with one JSON object per line and nothing else:",
  '{"type":"tool_call","name":"<tool name>","arguments":{ ... }}',
  "Rules:",
  "- One tool call per line. Several lines = several calls, executed in order.",
  "- When you emit tool calls, the whole reply must be those lines. No prose, no code fences.",
  "- Otherwise answer in normal Markdown; that text is shown to the user as-is.",
  "- A missing or malformed JSON line is treated as plain text, so never guess field names.",
].join("\n");

const DEFAULT_MAX_CHARS = 60_000;
const HEAD_CHARS = 2_000;
const TAIL_CHARS = 8_000;
const DEFAULT_FROM_INDEX = 0;

export interface SerializeOptions {
  /** First message index to render. Earlier messages were already delivered. */
  fromIndex?: number;
  /** Render the system prompt, tool catalog and protocol rules. First turn only. */
  includeBootstrap?: boolean;
  /** Total character budget for the rendered text. */
  maxChars?: number;
}

function toolCatalog(tools: Context["tools"]): string {
  if (!tools || tools.length === 0) return "";
  const blocks = tools.map((tool) => {
    const schema = JSON.stringify(tool.parameters ?? {});
    return [`### ${tool.name}`, tool.description.trim(), `parameters: ${schema}`].join("\n");
  });
  return ["## Tools", ...blocks].join("\n\n");
}

/** Clip one long block, keeping both ends: head carries intent, tail carries the verdict. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  const omitted = text.length - head.length - tail.length;
  return `${head}\n\n[... ${omitted} characters omitted ...]\n\n${tail}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const part = item as { type?: string; text?: string };
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part.type === "image") parts.push("[image omitted: this channel is text only]");
  }
  return parts.join("\n");
}

function renderMessage(message: Message): string {
  if (message.role === "user") {
    return `### USER\n${textOf(message.content)}`;
  }
  if (message.role === "toolResult") {
    const status = message.isError ? "error" : "ok";
    const body = clip(textOf(message.content), 12_000);
    return `### TOOL_RESULT ${message.toolName} (${message.toolCallId}) [${status}]\n${body}`;
  }
  const parts: string[] = [];
  for (const item of message.content) {
    if (item.type === "text" && item.text.trim()) parts.push(item.text);
    // Thinking blocks stay out of the page: they are the assistant's, not the model's,
    // and replaying them invites the page model to imitate a reasoning format it cannot see.
    if (item.type === "toolCall") {
      parts.push(
        JSON.stringify({ type: "tool_call", name: item.name, arguments: item.arguments ?? {} }),
      );
    }
  }
  if (parts.length === 0) return "";
  return `### ASSISTANT\n${parts.join("\n")}`;
}

/**
 * Render the text to type into the web page for one model call.
 *
 * Returns an empty string when nothing new happened since `fromIndex`; callers
 * treat that as a programming error rather than sending an empty composer.
 */
export function serializeContext(context: Context, options: SerializeOptions = {}): string {
  const fromIndex = Math.max(0, options.fromIndex ?? DEFAULT_FROM_INDEX);
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const sections: string[] = [];

  if (options.includeBootstrap === true) {
    const system = context.systemPrompt?.trim();
    if (system) sections.push(`# SYSTEM\n${system}`);
    const catalog = toolCatalog(context.tools);
    if (catalog) sections.push(catalog);
    if (catalog) sections.push(TOOL_PROTOCOL);
  }

  const turns = context.messages
    .slice(fromIndex)
    .map(renderMessage)
    .filter((block) => block.length > 0);
  if (turns.length > 0) {
    sections.push(`# CONVERSATION\n${turns.join("\n\n")}`);
  }
  if (sections.length === 0) return "";
  return `${sections.join("\n\n")}\n`;
}
