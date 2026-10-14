/**
 * Splits text around emoji that have a Tabler icon (ADR 0090). Pure: the
 * Markdown, static-artifact and iframe paths all build their nodes from this.
 */
import { EMOJI_ICON_GLYPHS } from './emoji-icon-glyphs.generated.js';
import { EMOJI_ICON_NAMES } from './emoji-icon-map.js';
import type { EmojiIconGlyphNode, EmojiTextSegment } from './emoji-icon-types.js';

/** One emoji, including ZWJ sequences, skin tones and variation selectors. */
export const EMOJI_SEQUENCE_SOURCE =
  '\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?\\p{Emoji_Modifier}?(?:\\u200D\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?\\p{Emoji_Modifier}?)*';
/** Folded away before lookup so 👍🏽 and ✔️ share 👍 and ✔. */
export const EMOJI_FOLD_SOURCE = '[\\uFE0E\\uFE0F]|\\p{Emoji_Modifier}';

export const EMOJI_ICON_CLASS = 'piwin-emoji-icon';

const FOLD = new RegExp(EMOJI_FOLD_SOURCE, 'gu');
const PRESENTATION = /^\p{Emoji_Presentation}/u;

export function normalizeEmojiKey(emoji: string): string {
  return emoji.replace(FOLD, '');
}

/**
 * Icon for one emoji, or null to keep the system glyph. Characters that the
 * system draws as plain text (↗, ©, ✔ without U+FE0F) are left alone: only
 * what would render as a color emoji is replaced.
 */
export function resolveEmojiIcon(emoji: string): string | null {
  if (emoji.includes('︎')) return null;
  const rendersAsEmoji =
    emoji.includes('️') || emoji.includes('‍') || PRESENTATION.test(emoji);
  if (!rendersAsEmoji) return null;
  const icon = EMOJI_ICON_NAMES[normalizeEmojiKey(emoji)];
  return icon !== undefined && EMOJI_ICON_GLYPHS[icon] !== undefined ? icon : null;
}

/** Returns null when nothing in `text` maps to an icon (the common case). */
export function segmentEmojiText(text: string): EmojiTextSegment[] | null {
  const pattern = new RegExp(EMOJI_SEQUENCE_SOURCE, 'gu');
  const segments: EmojiTextSegment[] = [];
  let cursor = 0;
  let replaced = false;
  for (const match of text.matchAll(pattern)) {
    const icon = resolveEmojiIcon(match[0]);
    if (icon === null) continue;
    const start = match.index;
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'icon', emoji: match[0], icon });
    cursor = start + match[0].length;
    replaced = true;
  }
  if (!replaced) return null;
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

export function getEmojiIconGlyph(icon: string): readonly EmojiIconGlyphNode[] | null {
  return EMOJI_ICON_GLYPHS[icon] ?? null;
}
