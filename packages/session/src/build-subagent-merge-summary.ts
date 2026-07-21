/**
 * Deterministic extractive summary of a child sub-agent transcript for parent merge.
 * No second LLM call (cost / latency / privacy).
 */
import type { AgentMessageView, SessionTranscriptMessage } from '@piwin/contracts';

export const MAX_SUBAGENT_SUMMARY_CHARS = 4000;

export type SubagentMergeSummaryInput = {
  task?: string;
  name?: string;
  status?: string;
  messages: Array<Pick<AgentMessageView | SessionTranscriptMessage, 'role' | 'text'> & {
    status?: string;
  }>;
  includeToolNames?: boolean;
  maxChars?: number;
};

export type SubagentMergeSummaryResult = {
  summaryText: string;
  preview: string;
  truncated: boolean;
};

/**
 * Build a bounded plain-text summary from child assistant messages.
 */
export function buildSubagentMergeSummary(
  input: SubagentMergeSummaryInput,
): SubagentMergeSummaryResult {
  const maxChars = input.maxChars ?? MAX_SUBAGENT_SUMMARY_CHARS;
  const assistantParts: string[] = [];

  for (const message of input.messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    if (message.status && message.status !== 'done' && message.status !== 'streaming') {
      // Prefer finished assistant turns; still allow streaming leftovers as partial.
      if (message.status === 'error') {
        continue;
      }
    }
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!text) {
      continue;
    }
    // Skip pure tool-dump-looking lines unless opted in.
    if (!input.includeToolNames && looksLikeToolDump(text)) {
      continue;
    }
    assistantParts.push(text);
  }

  let body =
    assistantParts.length > 0
      ? assistantParts.join('\n\n')
      : 'Sub-agent produced no assistant text.';

  let truncated = false;
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}…[truncated]`;
    truncated = true;
  }

  const headerLines: string[] = [];
  const displayName = input.name?.trim() || 'sub-agent';
  const statusLabel = input.status ?? 'done';
  headerLines.push(`Sub-agent “${displayName}” finished (${statusLabel})`);
  if (input.task?.trim()) {
    headerLines.push(`Task: ${input.task.trim()}`);
  }
  headerLines.push('Summary:');
  headerLines.push(body);

  const summaryText = headerLines.join('\n');
  const preview = body.slice(0, 160).replace(/\s+/g, ' ').trim();

  return { summaryText, preview, truncated };
}

/**
 * Format the parent transcript system message for merge (includes child id link).
 */
export function formatSubagentMergeCard(input: {
  summaryText: string;
  childSessionId: string;
}): string {
  return `${input.summaryText}\n\nchildSessionId=${input.childSessionId}\n(Open child session to inspect full transcript.)`;
}

function looksLikeToolDump(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return true;
  }
  if (trimmed.startsWith('[') && trimmed.includes('"tool')) {
    return true;
  }
  return false;
}
