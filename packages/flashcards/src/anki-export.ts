/**
 * Anki-importable TSV export: front, back, deck, tags columns.
 * Emits Anki file-header directives so import settings are self-describing
 * (tab separator, HTML on — newlines become <br>).
 */
import type { FlashcardReviewCard } from '@piwin/contracts';

function escapeTsvField(value: string): string {
  // Anki TSV has no quoting; flatten tabs/newlines to spaces / <br>.
  const escaped = value.replaceAll('\t', ' ').replaceAll(/\r?\n/g, '<br>');
  // Lines starting with '#' are Anki comments and would be silently dropped
  // on import; markdown headings in fronts are common, so guard with a space.
  return escaped.startsWith('#') ? ` ${escaped}` : escaped;
}

const ANKI_HEADER = '#separator:tab\n#html:true\n#columns:front\tback\tdeck\ttags\n';

export function exportCardsToTsv(cards: FlashcardReviewCard[]): string {
  if (cards.length === 0) {
    return '';
  }
  const lines = cards.map((card) =>
    [
      escapeTsvField(card.front),
      escapeTsvField(card.back),
      escapeTsvField(card.deck),
      escapeTsvField((card.tags ?? []).join(' ')),
    ].join('\t'),
  );
  return ANKI_HEADER + lines.join('\n') + '\n';
}
