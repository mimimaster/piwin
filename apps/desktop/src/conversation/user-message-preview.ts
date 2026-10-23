/**
 * A collapsed user card shows only its first lines under a fade. Blank lines
 * there spend that preview on empty space — a heading followed by a paragraph
 * break leaves the fade over nothing, so the card reads as an empty slab with
 * no hint that it expands. The preview drops blank lines; the expanded card
 * and copy keep the original text.
 */
export function compactCollapsedPreview(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\n(?:[ \t]*\n)+/g, '\n');
}
