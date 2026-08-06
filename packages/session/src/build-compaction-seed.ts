/** Convert the product transcript into text messages for a compact snapshot. */

import type { SessionSeedMessage, SessionTranscriptMessage } from '@piwin/contracts';

export function buildCompactionSeedMessages(
  messages: readonly SessionTranscriptMessage[],
): SessionSeedMessage[] {
  const seedMessages: SessionSeedMessage[] = [];
  for (const message of messages) {
    const text = buildSeedText(message);
    if (!text) continue;
    seedMessages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text,
      timestamp: parseTimestamp(message.createdAt),
    });
  }
  return seedMessages;
}

function buildSeedText(message: SessionTranscriptMessage): string {
  const sections: string[] = [];
  const messageText = message.text.trim();
  if (messageText) {
    sections.push(messageText);
  }

  if (message.tools && message.tools.length > 0) {
    const toolSections = message.tools
      .map((tool) => {
        const output = tool.output.trim();
        return output
          ? `Tool ${tool.toolName} (${tool.status}) output:\n${output}`
          : `Tool ${tool.toolName} (${tool.status}) returned no output.`;
      })
      .join('\n\n');
    sections.push(toolSections);
  }

  if (message.attachments && message.attachments.length > 0) {
    sections.push(`[${message.attachments.length} media attachment(s) omitted from snapshot]`);
  }

  if (message.role === 'system') {
    return sections.length > 0 ? `[Original system context]\n${sections.join('\n\n')}` : '';
  }
  if (message.role === 'tool') {
    return sections.length > 0 ? `[Original tool result]\n${sections.join('\n\n')}` : '';
  }
  return sections.join('\n\n');
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
