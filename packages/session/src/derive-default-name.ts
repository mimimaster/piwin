/** Max length for a text-derived default session name. */
const MAX_DEFAULT_NAME_CHARS = 60;

/**
 * Derive a human-readable fallback session name from the first user message.
 * Pure: no FS, no network. Strips markdown, URLs, collapses whitespace,
 * truncates on a word boundary with an ellipsis. Returns '' when nothing
 * meaningful remains (caller keeps existing placeholder).
 */
export function deriveDefaultNameFromMessage(text: string): string {
  let cleaned = text;
  // Strip markdown headers, bold, italic, inline code, code fences.
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
  cleaned = cleaned.replace(/__(.+?)__/g, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
  cleaned = cleaned.replace(/_(.+?)_/g, '$1');
  // Inline code: keep content, strip backticks. Code fences (```...```) removed entirely.
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  // Strip URLs.
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  // Collapse whitespace.
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned.length <= MAX_DEFAULT_NAME_CHARS) {
    return cleaned;
  }
  // Truncate at the last word boundary before the limit.
  const slice = cleaned.slice(0, MAX_DEFAULT_NAME_CHARS - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? lastSpace : slice.length;
  return `${cleaned.slice(0, cut).trimEnd()}…`;
}
