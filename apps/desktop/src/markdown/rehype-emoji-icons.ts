/**
 * Rehype pass for chat Markdown (ADR 0090): mapped emoji become inline Tabler
 * icons. Runs after Streamdown's defaults (so sanitize never sees the SVG) and
 * skips code, pre, svg and math. Unmapped emoji stay system glyphs.
 */
import {
  EMOJI_ICON_CLASS,
  EMOJI_ICON_CSS,
  EMOJI_ICON_SKIP_TAGS,
  EMOJI_ICON_SVG_ATTRIBUTES,
  EMOJI_ICON_TEXT_CLASS,
  getEmojiIconGlyph,
  segmentEmojiText,
} from '@piwin/artifact';
import { readHostStyleNonce } from '../host/host-style-nonce.js';

type HastText = { type: 'text'; value: string };
type HastElement = {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
};
type HastParent = { type: string; children?: HastNode[] };
type HastNode = HastText | HastElement | HastParent;

const SKIP = new Set(EMOJI_ICON_SKIP_TAGS);

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function hastProperties(attrs: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'xmlns') continue;
    out[camel(key)] = value;
  }
  return out;
}

const SVG_PROPERTIES = hastProperties(EMOJI_ICON_SVG_ATTRIBUTES);

function iconElement(emoji: string, icon: string): HastElement | null {
  const glyph = getEmojiIconGlyph(icon);
  if (!glyph) return null;
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [EMOJI_ICON_CLASS], dataEmojiIcon: icon },
    children: [
      {
        type: 'element',
        tagName: 'svg',
        properties: { ...SVG_PROPERTIES },
        children: glyph.map(([tag, attrs]) => ({
          type: 'element' as const,
          tagName: tag,
          properties: hastProperties(attrs),
          children: [],
        })),
      },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: [EMOJI_ICON_TEXT_CLASS] },
        children: [{ type: 'text', value: emoji }],
      },
    ],
  };
}

function isSkippedElement(node: HastElement): boolean {
  if (SKIP.has(node.tagName)) return true;
  const cls = node.properties['className'];
  const list = Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? cls.split(/\s+/) : [];
  return list.some((c) => c === EMOJI_ICON_CLASS || c === 'katex' || c.startsWith('math') || c === 'language-math');
}

function transform(parent: HastParent): void {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    if (child.type === 'text') {
      const segments = segmentEmojiText((child as HastText).value);
      if (!segments) continue;
      const replacement: HastNode[] = [];
      for (const segment of segments) {
        const node =
          segment.kind === 'text' ? null : iconElement(segment.emoji, segment.icon);
        replacement.push(
          node ?? { type: 'text', value: segment.kind === 'text' ? segment.text : segment.emoji },
        );
      }
      children.splice(i, 1, ...replacement);
      i += replacement.length - 1;
      continue;
    }
    if (child.type === 'element' && isSkippedElement(child as HastElement)) continue;
    transform(child as HastParent);
  }
}

function ensureEmojiIconStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.head.querySelector('style[data-piwin-emoji-icons]')) return;
  const style = document.createElement('style');
  style.dataset['piwinEmojiIcons'] = '';
  // Without the host nonce the packaged CSP drops this sheet and every icon
  // SVG stretches to the column width.
  const nonce = readHostStyleNonce();
  if (nonce) style.nonce = nonce;
  style.textContent = EMOJI_ICON_CSS;
  document.head.appendChild(style);
}

/** Unified attacher: `rehypePlugins={[...defaults, rehypeEmojiIcons]}`. */
export function rehypeEmojiIcons() {
  ensureEmojiIconStyle();
  return (tree: HastParent): void => {
    transform(tree);
  };
}
