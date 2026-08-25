import type { HealthToolCardSummary, MediaAttachmentRef } from '@piwin/contracts';
import { projectBoundedHealthToolCardSummary } from '@piwin/contracts';

/**
 * Extract display/model text from a Pi tool result payload.
 *
 * Pi `tool_execution_end.result` is `AgentToolResult`:
 * `{ content: Array<{ type: 'text', text: string } | ImageContent>, details }`.
 * Also accepts a plain string (legacy / host-normalized shapes).
 */
export function extractToolResultText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const content = record.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      const part = asRecord(item);
      if (!part) {
        continue;
      }
      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        parts.push(part.text);
      }
    }
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }
  const directText = typeof record.text === 'string' ? record.text : undefined;
  return directText !== undefined && directText.length > 0 ? directText : undefined;
}

/**
 * Extract displayable media outputs from a Host tool's structured details.
 * The path is still checked again by the Desktop media URL resolver before it
 * becomes an image source, so arbitrary tool details cannot bypass that gate.
 */
export function extractToolResultAttachments(value: unknown): MediaAttachmentRef[] | undefined {
  const record = asRecord(value);
  const rawAttachments = record?.attachments;
  if (!Array.isArray(rawAttachments)) {
    return undefined;
  }

  const attachments = rawAttachments.filter(isMediaAttachmentRef);
  return attachments.length > 0 ? attachments : undefined;
}

export type ToolResultHealthFields = {
  health?: HealthToolCardSummary;
  sensitivity?: 'health';
};

/** Copy bounded Health card fields from ToolResult.details onto presentation. */
export function extractToolResultHealthDetails(value: unknown): ToolResultHealthFields {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const fields: ToolResultHealthFields = {};
  if (record.sensitivity === 'health') {
    fields.sensitivity = 'health';
  }
  const health = projectBoundedHealthToolCardSummary(record.health);
  if (health !== undefined) {
    fields.health = health;
  }
  return fields;
}

function isMediaAttachmentRef(value: unknown): value is MediaAttachmentRef {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    typeof record.id === 'string' &&
    record.kind === 'media' &&
    typeof record.path === 'string' &&
    typeof record.mimeType === 'string' &&
    typeof record.byteSize === 'number' &&
    Number.isFinite(record.byteSize) &&
    record.byteSize >= 0 &&
    (record.source === 'paste' ||
      record.source === 'drop' ||
      record.source === 'file-picker' ||
      record.source === 'generated')
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}
