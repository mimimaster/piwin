import type {
  AgentMessageRole,
  SessionOutlineNode,
  SessionTranscriptMessage,
} from '@piwin/contracts';

const PREVIEW_MAX_CHARS = 120;

/**
 * Build a linear message outline from product transcript.
 * Source of truth for chat body remains the full transcript messages.
 */
export function buildSessionOutline(
  messages: readonly SessionTranscriptMessage[],
): SessionOutlineNode[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as AgentMessageRole,
    preview: buildPreview(message.text),
    createdAt: message.createdAt,
  }));
}

function buildPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}
