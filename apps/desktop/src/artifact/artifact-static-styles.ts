import { readHostStyleNonce } from '../host/host-style-nonce.js';

/**
 * Split a CSS declaration list on top-level `;`, ignoring separators nested in
 * `()`/`[]` or quotes. The one-declaration-per-string result keeps shorthands
 * whole (`background`, `border`, `font`), unlike iterating CSSOM longhands.
 */
export function splitStyleDeclarations(cssText: string): string[] {
  const declarations: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let index = 0; index < cssText.length; index += 1) {
    const char = cssText[index];
    if (quote !== null) {
      if (char === quote && cssText[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    else if (char === ';' && depth === 0) {
      declarations.push(cssText.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(cssText.slice(start));
  return declarations.filter((declaration) => declaration.trim().length > 0);
}

/** A raw `name: value` declaration parsed into a CSSOM `setProperty` triple. */
export function parseStyleDeclaration(
  declaration: string,
): { name: string; value: string; priority: '' | 'important' } | null {
  const colon = declaration.indexOf(':');
  if (colon < 0) return null;
  const name = declaration.slice(0, colon).trim();
  let value = declaration.slice(colon + 1).trim();
  if (name.length === 0 || value.length === 0) return null;
  let priority: '' | 'important' = '';
  const important = /!\s*important\s*$/i.exec(value);
  if (important) {
    priority = 'important';
    value = value.slice(0, important.index).trim();
    if (value.length === 0) return null;
  }
  return { name, value, priority };
}

/** Authorize already-sanitized static Artifact CSS under the packaged host CSP. */
export function authorizeStaticArtifactStyles(
  baseStyle: HTMLStyleElement,
  content: HTMLElement,
): void {
  const nonce = readHostStyleNonce();
  if (!nonce) return;

  baseStyle.nonce = nonce;
  for (const style of content.querySelectorAll<HTMLStyleElement>('style')) {
    style.nonce = nonce;
  }

  // A nonce authorizes style blocks, never style attributes. Re-apply the
  // sanitizer's surviving declarations through CSSOM `setProperty`, which the
  // CSP does not gate. Set each declaration by its original text rather than
  // enumerating CSSOM longhands: a shorthand holding a `var()` (e.g.
  // `background: var(--piwin-artifact-surface)`) serializes every expanded
  // longhand to the empty string, so longhand enumeration silently drops the
  // fill and border of every themed card. `setProperty` still validates each
  // value, so the untrusted-source policy stays in force.
  for (const element of content.querySelectorAll<HTMLElement | SVGElement>('[style]')) {
    const cssText = element.getAttribute('style') ?? '';
    element.removeAttribute('style');
    for (const declaration of splitStyleDeclarations(cssText)) {
      const parsed = parseStyleDeclaration(declaration);
      if (parsed === null) continue;
      element.style.setProperty(parsed.name, parsed.value, parsed.priority);
    }
  }
}
