/**
 * Split a bash command into `&&` / `;` chain segments so bundled allow rules
 * can match `cd /x && ls foo/` as `cd` + `ls` rather than one unmatched string.
 *
 * Not a shell parser: quoted `&&` / `;` are left intact; pipelines (`|`) and
 * `||` stay one segment.
 */
export function splitBashCommandChain(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote !== null) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = '';
      continue;
    }
    if (character === '&' && command[index + 1] === '&') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = '';
      index += 1;
      continue;
    }
    current += character;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    segments.push(trimmed);
  }
  return segments.length > 0 ? segments : [command.trim()].filter((item) => item.length > 0);
}
