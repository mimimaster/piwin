/**
 * Parsing for Playwright `ariaSnapshot({ mode: 'ai', boxes: true })` output.
 *
 * NOTE on `yaml`: the output is not actually parseable as YAML — Playwright emits
 * one plain scalar per line with inline `[ref=eN]`/`[box=x,y,w,h]` annotations and
 * indentation-based nesting. The `yaml` package folds indented `- child` lines into
 * the parent scalar (and throws `MULTILINE_IMPLICIT_KEY` on lines ending in `:`), so
 * the tree is derived here with a small line parser instead. Verified against real
 * Chromium 149 output (2026-07): lines look like:
 *
 *   - document [ref=e1] [box=0,0,1280,308]:
 *     - generic [active] [ref=e2] [box=8,8,1264,292]:
 *       - button "Submit form" [ref=e13] [box=8,193,88,21]
 *       - paragraph [ref=e12] [box=8,158,1264,18]: Hello world this is a paragraph.
 *       - text: Agree
 *         - /url: /a
 */
import type { BrowserSnapshotNode } from '@piwin/contracts';

/** Viewport-relative CSS px box (from `[box=x,y,w,h]`). */
export type SnapshotNodeBox = { x: number; y: number; width: number; height: number };

/** `BrowserSnapshotNode` plus the `box` annotation used for pick-by-point matching. */
export type BrowserSnapshotNodeWithBox = {
  role: string;
  name?: string;
  ref?: string;
  level?: number;
  checked?: boolean;
  box?: SnapshotNodeBox;
  children: BrowserSnapshotNodeWithBox[];
};

/** Parses the raw ariaSnapshot YAML text into a `BrowserSnapshotNode` tree. */
export function parseAriaSnapshot(yamlText: string): BrowserSnapshotNodeWithBox[] {
  const roots: BrowserSnapshotNodeWithBox[] = [];
  const stack: { indent: number; node: BrowserSnapshotNodeWithBox }[] = [];

  for (const rawLine of yamlText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;

    const indent = countLeadingWhitespace(line);
    const content = line.slice(indent);
    if (!content.startsWith('- ')) continue; // defensive: skip unexpected non-list lines

    const node = parseNodeLine(content.slice(2));

    // Pop ancestors that are not parents of this line's indent.
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();

    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.node.children.push(node);

    stack.push({ indent, node });
  }
  return roots;
}

/** The deepest ref'd node whose box contains the point (document order tiebreak). */
export function matchRefByPoint(
  nodes: readonly BrowserSnapshotNodeWithBox[],
  x: number,
  y: number,
): string | undefined {
  let best: { depth: number; ref: string } | undefined;

  function walk(list: readonly BrowserSnapshotNodeWithBox[], depth: number): void {
    for (const node of list) {
      const box = node.box;
      if (node.ref !== undefined && box !== undefined && pointInBox(x, y, box)) {
        if (best === undefined || depth > best.depth) best = { depth, ref: node.ref };
      }
      if (node.children.length > 0) walk(node.children, depth + 1);
    }
  }

  walk(nodes, 0);
  return best?.ref;
}

function pointInBox(x: number, y: number, box: SnapshotNodeBox): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function countLeadingWhitespace(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ' || ch === '\t') count += 1;
    else break;
  }
  return count;
}

/**
 * Parses the payload after `- ` (e.g. `button "Submit" [ref=e4] [box=10,20,100,30]`
 * or `paragraph [ref=e12] [box=8,158,1264,18]: Hello world` or `text: Agree`).
 * The accessible name comes from either the quoted `"name"` or, when absent, the
 * visible text after `: ` (mapped into `name` because the contract node has no text
 * field).
 */
function parseNodeLine(rest: string): BrowserSnapshotNodeWithBox {
  const node: BrowserSnapshotNodeWithBox = { role: '', children: [] };
  let rest_ = rest;

  const roleMatch = /^[^\s"[:]+/.exec(rest_);
  if (roleMatch === null) return node;
  node.role = roleMatch[0];
  rest_ = rest_.slice(roleMatch[0].length);

  rest_ = rest_.trimStart();
  const name = readQuotedName(rest_);
  if (name !== undefined) {
    node.name = name.value;
    rest_ = name.rest;
  }

  applyAnnotations(node, rest_);
  rest_ = rest_.replace(/\[[^\]]*\]/g, '').trim();

  if (rest_.startsWith(':')) {
    const text = rest_.slice(1).trim();
    if (text !== '' && node.name === undefined) node.name = text;
  }

  return node;
}

/** Reads a leading double-quoted name, handling `\"` escapes. Returns undefined if none. */
function readQuotedName(s: string): { value: string; rest: string } | undefined {
  if (!s.startsWith('"')) return undefined;
  let value = '';
  let i = 1;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length) {
      value += s[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { value, rest: s.slice(i + 1) };
    }
    value += ch;
    i += 1;
  }
  // Unterminated quote: treat the rest as the name.
  return { value, rest: '' };
}

/** Applies `[annotation]` tokens, e.g. `[ref=e5]`, `[box=0,0,1280,64]`, `[level=1]`, `[checked]`. */
function applyAnnotations(node: BrowserSnapshotNodeWithBox, s: string): void {
  const annotationRe = /\[([^\]]*)\]/g;
  for (const match of s.matchAll(annotationRe)) {
    const annotation = match[1]!;
    const eq = annotation.indexOf('=');
    const key = eq === -1 ? annotation : annotation.slice(0, eq);
    const value = eq === -1 ? '' : annotation.slice(eq + 1);
    switch (key) {
      case 'ref':
        node.ref = value;
        break;
      case 'box': {
        const [x, y, w, h] = value.split(',').map((part) => Number(part));
        if (
          x !== undefined &&
          y !== undefined &&
          w !== undefined &&
          h !== undefined &&
          !Number.isNaN(x)
        ) {
          node.box = { x, y, width: w, height: h };
        }
        break;
      }
      case 'level': {
        const level = Number(value);
        if (!Number.isNaN(level)) node.level = level;
        break;
      }
      case 'checked':
        node.checked = value === '' ? true : value === 'true';
        break;
      default:
        break; // [active], [cursor=pointer], [selected], [expanded], … are not modelled
    }
  }
}
