/**
 * Anki-importable TSV export: front, back, deck, tags columns.
 * Anki import: File → Import, field separator Tab, allow HTML off.
 */
import type { FlashcardRecord } from '@piwin/contracts';

function escapeTsvField(value: string): string {
  // Anki TSV has no quoting; flatten tabs/newlines to spaces / <br>.
  return value.replaceAll('\t', ' ').replaceAll(/\r?\n/g, '<br>');
}

export function exportCardsToTsv(cards: FlashcardRecord[]): string {
  const lines = cards.map((card) =>
    [
      escapeTsvField(card.front),
      escapeTsvField(card.back),
      escapeTsvField(card.deck),
      escapeTsvField((card.tags ?? []).join(' ')),
    ].join('\t'),
  );
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}
