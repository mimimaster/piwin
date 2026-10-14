type SourceToken = { text: string; literal: boolean };

/** Best-effort literal metadata only. Listing must never evaluate extension code. */
export function detectExtensionCommandDescriptions(source: string): Record<string, string> {
  const tokens = tokenize(source);
  const descriptions = new Map<string, string>();
  const seen = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.literal || tokens[index]?.text !== 'registerCommand' || tokens[index + 1]?.text !== '(') continue;
    const first = tokens[index + 2];
    const objectIndex = first?.literal && tokens[index + 3]?.text === ',' ? index + 4 : index + 2;
    if (tokens[objectIndex]?.text !== '{') continue;
    const properties = readProperties(tokens, objectIndex);
    const name = first?.literal ? first.text : properties.get('name');
    const description = properties.get('description')?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (description) descriptions.set(name, description);
  }
  return Object.fromEntries(descriptions);
}

function readProperties(tokens: SourceToken[], start: number): Map<string, string> {
  const properties = new Map<string, string>();
  let depth = 1;
  for (let index = start + 1; index < tokens.length && depth > 0; index++) {
    const token = tokens[index];
    if (!token) continue;
    const previous = tokens[index - 1]?.text;
    const value = tokens[index + 2];
    const following = tokens[index + 3]?.text;
    if (depth === 1 && (previous === '{' || previous === ',') && tokens[index + 1]?.text === ':' && value?.literal && (following === ',' || following === '}')) {
      properties.set(token.text, value.text);
    }
    if (token.literal) continue;
    if (['{', '[', '('].includes(token.text)) depth++;
    if (['}', ']', ')'].includes(token.text)) depth--;
  }
  return properties;
}

function tokenize(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (!character) break;
    if (/\s/.test(character)) { index++; continue; }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2); index = end < 0 ? source.length : end + 1; continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue;
    }
    if (['"', "'", '`'].includes(character)) {
      const quoted = readQuoted(source, index, character);
      tokens.push({ text: quoted.value ?? '', literal: quoted.value !== undefined });
      index = quoted.end; continue;
    }
    if (/[\w$]/.test(character)) {
      const start = index++;
      while (index < source.length && /[\w$]/.test(source[index] ?? '')) index++;
      tokens.push({ text: source.slice(start, index), literal: false }); continue;
    }
    tokens.push({ text: character, literal: false }); index++;
  }
  return tokens;
}

function readQuoted(source: string, start: number, quote: string): { value?: string; end: number } {
  const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
  let value = '';
  let dynamic = false;
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (character === quote) return { ...(!dynamic ? { value } : {}), end: index + 1 };
    if (quote === '`' && character === '$' && source[index + 1] === '{') dynamic = true;
    if (character !== '\\') { value += character ?? ''; continue; }
    const escaped = source[++index];
    if (escaped === undefined) break;
    if (escaped === '\n') continue;
    if (escaped === '\r') { if (source[index + 1] === '\n') index++; continue; }
    if (escaped === 'u' || escaped === 'x') {
      const size = escaped === 'u' ? 4 : 2;
      const digits = source.slice(index + 1, index + 1 + size);
      if (digits.length !== size || !/^[\da-f]+$/i.test(digits)) dynamic = true;
      else { value += String.fromCharCode(Number.parseInt(digits, 16)); index += size; }
    } else value += escapes[escaped] ?? escaped;
  }
  return { end: source.length };
}
