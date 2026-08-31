/**
 * Streamdown still parses raw HTML even with `skipHtml` (rehype-raw + sanitize).
 * Safe tags such as `<div>` become real DOM and split the paragraph; the
 * tags themselves disappear from the visible text. Coding-agent replies talk
 * about HTML all the time, so escape tag-like `<` outside code before parse.
 *
 * Leaves `a < b` alone (next char is not a tag starter).
 */

function isHtmlTagStarter(char: string | undefined): boolean {
  return char === '/' || char === '!' || char === '?' || /^[A-Za-z]$/.test(char ?? '');
}

function fenceMarkerAt(markdown: string, index: number): { char: '`' | '~'; length: number } | null {
  const char = markdown[index];
  if (char !== '`' && char !== '~') {
    return null;
  }
  let length = 0;
  while (markdown[index + length] === char) {
    length += 1;
  }
  return length >= 3 ? { char, length } : null;
}

function skipLinePrefix(markdown: string, index: number): number {
  let cursor = index;
  let spaces = 0;
  while (spaces < 3 && markdown[cursor] === ' ') {
    spaces += 1;
    cursor += 1;
  }
  return cursor;
}

export function escapeRawHtmlInMarkdown(markdown: string): string {
  let output = '';
  let index = 0;
  let fence: { char: '`' | '~'; length: number } | null = null;
  let atLineStart = true;

  while (index < markdown.length) {
    if (atLineStart) {
      const afterPrefix = skipLinePrefix(markdown, index);
      const marker = fenceMarkerAt(markdown, afterPrefix);
      if (marker) {
        if (!fence) {
          fence = marker;
        } else if (marker.char === fence.char && marker.length >= fence.length) {
          fence = null;
        }
        const lineEnd = markdown.indexOf('\n', index);
        const consumeTo = lineEnd === -1 ? markdown.length : lineEnd + 1;
        output += markdown.slice(index, consumeTo);
        index = consumeTo;
        atLineStart = lineEnd !== -1;
        continue;
      }
    }

    if (fence) {
      const nextNewline = markdown.indexOf('\n', index);
      const consumeTo = nextNewline === -1 ? markdown.length : nextNewline + 1;
      output += markdown.slice(index, consumeTo);
      index = consumeTo;
      atLineStart = nextNewline !== -1;
      continue;
    }

    const char = markdown[index] ?? '';
    if (char === '`') {
      let ticks = 0;
      while (markdown[index + ticks] === '`') {
        ticks += 1;
      }
      const closer = markdown.indexOf('`'.repeat(ticks), index + ticks);
      if (closer === -1) {
        output += markdown.slice(index);
        break;
      }
      const consumeTo = closer + ticks;
      output += markdown.slice(index, consumeTo);
      index = consumeTo;
      atLineStart = false;
      continue;
    }

    if (char === '<' && isHtmlTagStarter(markdown[index + 1])) {
      output += '&lt;';
      index += 1;
      atLineStart = false;
      continue;
    }

    output += char;
    atLineStart = char === '\n';
    index += 1;
  }

  return output;
}
