/**
 * Bounded scan for one complete top-level JSON object. Does not guess at
 * truncated documents or depend on V8 SyntaxError English wording.
 */

const MAX_PLAN_SCAN_CHARS = 64 * 1024;

export function extractLeadingJsonObject(
  raw: string,
): { json: string; trailingGarbage: boolean } | undefined {
  if (raw.length > MAX_PLAN_SCAN_CHARS) {
    return undefined;
  }
  let index = 0;
  while (index < raw.length) {
    const character = raw[index];
    if (
      character === ' ' ||
      character === '\n' ||
      character === '\r' ||
      character === '\t'
    ) {
      index += 1;
      continue;
    }
    break;
  }
  if (raw[index] !== '{') {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < raw.length; cursor += 1) {
    const character = raw[cursor];
    if (character === undefined) {
      return undefined;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (depth !== 0) {
        continue;
      }
      const json = raw.slice(index, cursor + 1);
      const rest = raw.slice(cursor + 1).trim();
      return { json, trailingGarbage: rest.length > 0 };
    }
  }
  return undefined;
}
