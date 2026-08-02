/** Max length for a text-derived default session name (titlebar-friendly). */
const MAX_DEFAULT_NAME_CHARS = 32;

/**
 * Derive a human-readable fallback session name from the first user message.
 * Pure: no FS, no network. Strips markdown, URLs, collapses whitespace,
 * truncates on a word boundary (Latin) or hard cut (CJK) with an ellipsis.
 * Returns '' when nothing meaningful remains (caller keeps existing placeholder).
 */
export function deriveDefaultNameFromMessage(text: string): string {
  let cleaned = text;
  // Strip injected walkthrough context directives (both XML and bracket formats).
  cleaned = cleaned.replace(/<walkthrough-context[\s\S]*?<\/walkthrough-context>/gi, '');
  cleaned = cleaned.replace(
    /\[piwin walkthrough context\][\s\S]*?\[end walkthrough context\]/gi,
    '',
  );
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

  const limit = MAX_DEFAULT_NAME_CHARS - 1; // room for …
  const slice = cleaned.slice(0, limit);
  // Prefer space boundary for Latin; for CJK (no space) cut at limit.
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(limit * 0.5) ? lastSpace : slice.length;
  return `${cleaned.slice(0, cut).trimEnd()}…`;
}
