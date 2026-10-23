import remend from 'remend';
import { parseMarkdownIntoBlocks } from 'streamdown';

/**
 * Close the syntax a streaming reply has left open (`**bold`, a half-written
 * link, …) so it renders as intended instead of as literal markers.
 *
 * Streamdown does this itself by running `remend` over the whole reply on
 * every token, and several of its passes rescan the document per candidate
 * marker: ~44ms a token at 46K characters. Only the block still being written
 * can be incomplete, so the repair runs on that block alone and the settled
 * text above it is passed through untouched.
 */
export function repairStreamingMarkdownTail(markdown: string): string {
  const blocks = parseMarkdownIntoBlocks(markdown);
  // The splitter can end on blank-line blocks; the block being written is the
  // last one with text in it.
  let tailStart = blocks.length - 1;
  while (tailStart > 0 && (blocks[tailStart] ?? '').trim().length === 0) {
    tailStart -= 1;
  }
  const tail = blocks.slice(tailStart).join('');
  if (tailStart <= 0 || tail.length === 0 || !markdown.endsWith(tail)) {
    return remend(markdown);
  }
  return markdown.slice(0, markdown.length - tail.length) + remend(tail);
}
