/**
 * Reply Writer prompt assembly and one-shot completion (spec: reply-writer).
 */
import type { ModelRef, ReplyWriterConfig, ReplyWriterLanguage } from '@piwin/contracts';
import { DEFAULT_REPLY_WRITER_TIMEOUT_MS } from '@piwin/contracts';
import {
  completeStructuredText,
  type StructuredCompletionDependencies,
} from './structured-completion.js';
import { StructuredCompletionError } from './structured-completion-error.js';
import type { ModelProviderConfig } from '@piwin/contracts';

export const DEFAULT_REPLY_WRITER_SYSTEM_PROMPT = `<reply_writer_contract>
You rewrite coding-agent draft replies into polished, clear, and professional developer communications.

## Invariants
1. **Factual & Technical Fidelity**: Preserve all file paths, command names, error messages, diffs, and numbers verbatim. Never invent facts.
2. **Anti-Laziness in Code**: Keep code blocks complete; never insert placeholder comments like "// ... existing code unchanged ...".
3. **Transparent Delivery**: Output ONLY the final response. Never mention rewriting, drafting, or underlying models.
</reply_writer_contract>`;

const USER_BODY_MAX_CHARS = 8_000;
const DRAFT_MAX_CHARS = 32_000;
const TOOL_OUTPUT_MAX_CHARS = 1_000;
const MAX_TOOLS = 8;
const SOURCE_TEXT_MAX_CHARS = 32_000;

export type ReplyWriterEvidence = {
  userText: string;
  draftText: string;
  tools: Array<{ name: string; output: string }>;
};

export function boundReplyWriterSourceText(text: string): string {
  return truncateChars(text, SOURCE_TEXT_MAX_CHARS);
}

export function assembleReplyWriterSystemPrompt(config: ReplyWriterConfig | undefined): string {
  const override = config?.systemPrompt?.trim();
  return override && override.length > 0 ? override : DEFAULT_REPLY_WRITER_SYSTEM_PROMPT;
}

export function assembleReplyWriterUserPrompt(params: {
  language: ReplyWriterLanguage;
  evidence: ReplyWriterEvidence;
}): string {
  const languageDirective =
    params.language === 'en'
      ? 'Output language: English.'
      : params.language === 'follow-user'
        ? "Output language: Match user's primary language."
        : 'Output language: 简体中文（语句通顺自然，避免电报体）。';
  const tools =
    params.evidence.tools.length === 0
      ? '(none)'
      : params.evidence.tools
          .slice(0, MAX_TOOLS)
          .map((tool, index) => {
            const output = truncateChars(tool.output.trim(), TOOL_OUTPUT_MAX_CHARS);
            return `${index + 1}. ${tool.name}\n${output || '(empty)'}`;
          })
          .join('\n\n');
  return `<directive>
${languageDirective}
</directive>

<user_message>
${truncateChars(params.evidence.userText.trim(), USER_BODY_MAX_CHARS) || '(empty)'}
</user_message>

<worker_draft>
${truncateChars(params.evidence.draftText.trim(), DRAFT_MAX_CHARS) || '(empty)'}
</worker_draft>

<tool_evidence>
${tools}
</tool_evidence>`;
}

export async function completeReplyWriter(params: {
  provider: ModelProviderConfig;
  model: ModelRef;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  signal: AbortSignal;
  dependencies?: StructuredCompletionDependencies;
}): Promise<string> {
  const result = await completeStructuredText(
    {
      provider: params.provider,
      modelId: params.model.modelId,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      temperature: 0.3,
      maxOutputTokens: 4096,
      signal: params.signal,
      timeoutMs: params.timeoutMs ?? DEFAULT_REPLY_WRITER_TIMEOUT_MS,
      label: 'Reply writer',
    },
    params.dependencies ?? {},
  );
  const text = result.text.trim();
  if (text.length === 0) {
    throw new StructuredCompletionError('empty-output', 'Reply writer returned no text');
  }
  return text;
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated]`;
}
