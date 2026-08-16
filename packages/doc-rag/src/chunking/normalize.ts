import type { ParsedBlock } from '@piwin/contracts';

export function normalizeParsedBlocks(blocks: ParsedBlock[]): ParsedBlock[] {
  const normalized: ParsedBlock[] = [];
  let order = 0;
  for (const block of blocks) {
    const text = block.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC').trim();
    if (text.length === 0) continue;
    normalized.push({
      ...block,
      order,
      text,
    });
    order += 1;
  }
  return normalized;
}
