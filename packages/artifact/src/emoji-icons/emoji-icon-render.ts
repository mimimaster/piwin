/**
 * Shared emoji → icon rendering (ADR 0090): CSS, a DOM pass for trees the
 * host owns (static artifacts), and the inline runtime for sandboxed iframes.
 *
 * Every replacement keeps the original emoji as visually hidden text inside
 * the icon span, so copy/paste and screen readers still get the character.
 */
import { EMOJI_ICON_GLYPHS } from './emoji-icon-glyphs.generated.js';
import { EMOJI_ICON_NAMES } from './emoji-icon-map.js';
import {
  EMOJI_FOLD_SOURCE,
  EMOJI_ICON_CLASS,
  EMOJI_SEQUENCE_SOURCE,
  segmentEmojiText,
} from './emoji-icon-text.js';
import type { EmojiIconGlyphNode } from './emoji-icon-types.js';

/** Structural DOM types: this package compiles without the DOM lib. */
export type EmojiIconDomElement = {
  localName: string;
  className: string;
  textContent: string | null;
  parentElement: EmojiIconDomElement | null;
  classList: { contains(token: string): boolean };
  dataset: Record<string, string | undefined>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(node: unknown): unknown;
  append(...nodes: unknown[]): void;
};
type EmojiIconDomText = {
  data: string;
  parentElement: EmojiIconDomElement | null;
  replaceWith(node: unknown): void;
};
export type EmojiIconDomDocument = {
  createElement(tag: string): EmojiIconDomElement;
  createElementNS(ns: string, tag: string): EmojiIconDomElement;
  createTextNode(text: string): unknown;
  createDocumentFragment(): { appendChild(node: unknown): unknown };
  createTreeWalker(root: unknown, whatToShow: number): { nextNode(): unknown };
};
export type EmojiIconDomRoot = { ownerDocument: EmojiIconDomDocument | null };

export const EMOJI_ICON_TEXT_CLASS = 'piwin-emoji-icon-text';

/** SVG root attributes shared by every renderer (Tabler outline grid). */
export const EMOJI_ICON_SVG_ATTRIBUTES: Readonly<Record<string, string>> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.75',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

/** Elements whose text is code, math, input or already graphics. */
export const EMOJI_ICON_SKIP_TAGS: readonly string[] = [
  'code', 'pre', 'kbd', 'samp', 'svg', 'math', 'script', 'style', 'textarea', 'input',
  'select', 'option', 'noscript', 'template', 'title',
];

/** 1em, follows the text color; the emoji char stays selectable but invisible. */
export const EMOJI_ICON_CSS = `.${EMOJI_ICON_CLASS}{display:inline-block;position:relative;width:1em;height:1em;vertical-align:-0.14em;line-height:1em;overflow:hidden;white-space:nowrap;color:inherit}
.${EMOJI_ICON_CLASS}>svg{position:absolute;inset:0;width:100%;height:100%}
.${EMOJI_ICON_CLASS}>.${EMOJI_ICON_TEXT_CLASS}{opacity:0;font-size:inherit}`;

/** Icon names used by `text`, sorted; empty when nothing maps. */
export function collectEmojiIcons(text: string): string[] {
  const icons = new Set<string>();
  const segments = segmentEmojiText(text);
  if (segments) for (const s of segments) if (s.kind === 'icon') icons.add(s.icon);
  return [...icons].sort();
}

function isSkipped(element: EmojiIconDomElement | null): boolean {
  for (let el = element; el; el = el.parentElement) {
    const tag = el.localName;
    if (EMOJI_ICON_SKIP_TAGS.includes(tag)) return true;
    if (el.classList.contains(EMOJI_ICON_CLASS) || el.classList.contains('katex')) return true;
    if (el.getAttribute('contenteditable') !== null && el.getAttribute('contenteditable') !== 'false') return true;
  }
  return false;
}

/** Builds the icon span for one emoji in `doc`. */
export function createEmojiIconElement(
  doc: EmojiIconDomDocument,
  emoji: string,
  icon: string,
  glyph: readonly EmojiIconGlyphNode[],
): EmojiIconDomElement {
  const NS = 'http://www.w3.org/2000/svg';
  const span = doc.createElement('span');
  span.className = EMOJI_ICON_CLASS;
  span.dataset['emojiIcon'] = icon;
  const svg = doc.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries(EMOJI_ICON_SVG_ATTRIBUTES)) if (k !== 'xmlns') svg.setAttribute(k, v);
  for (const [tag, attrs] of glyph) {
    const shape = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.appendChild(shape);
  }
  const text = doc.createElement('span');
  text.className = EMOJI_ICON_TEXT_CLASS;
  text.textContent = emoji;
  span.append(svg, text);
  return span;
}

/**
 * Replaces mapped emoji in text nodes under `root` (an element or shadow
 * root). Returns the number of icons inserted. Idempotent.
 */
export function replaceEmojiIconsInTree(root: EmojiIconDomRoot): number {
  const doc = root.ownerDocument ?? (root as unknown as EmojiIconDomDocument);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const targets: EmojiIconDomText[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as EmojiIconDomText;
    if (!text.data || isSkipped(text.parentElement)) continue;
    targets.push(text);
  }
  let count = 0;
  for (const text of targets) {
    const segments = segmentEmojiText(text.data);
    if (!segments) continue;
    const fragment = doc.createDocumentFragment();
    for (const segment of segments) {
      if (segment.kind === 'text') {
        fragment.appendChild(doc.createTextNode(segment.text));
        continue;
      }
      const glyph = EMOJI_ICON_GLYPHS[segment.icon];
      if (!glyph) {
        fragment.appendChild(doc.createTextNode(segment.emoji));
        continue;
      }
      fragment.appendChild(createEmojiIconElement(doc, segment.emoji, segment.icon, glyph));
      count += 1;
    }
    text.replaceWith(fragment);
  }
  return count;
}

/**
 * Inline `<style>` + `<script>` for a sandboxed srcdoc. `icons` limits the
 * payload to those glyphs (finished artifacts); `'all'` ships every glyph for
 * stream previews whose source is still arriving. Returns '' when a finished
 * artifact uses no mapped emoji.
 */
export function buildEmojiIconSrcdocHead(icons: readonly string[] | 'all'): string {
  const wanted = icons === 'all' ? null : new Set(icons);
  if (wanted && wanted.size === 0) return '';
  const names: Record<string, string> = {};
  for (const [emoji, icon] of Object.entries(EMOJI_ICON_NAMES)) {
    if (!wanted || wanted.has(icon)) names[emoji] = icon;
  }
  const glyphs: Record<string, readonly EmojiIconGlyphNode[]> = {};
  for (const icon of new Set(Object.values(names))) {
    const glyph = EMOJI_ICON_GLYPHS[icon];
    if (glyph) glyphs[icon] = glyph;
  }
  const config = JSON.stringify({
    names,
    glyphs,
    seq: EMOJI_SEQUENCE_SOURCE,
    fold: EMOJI_FOLD_SOURCE,
    cls: EMOJI_ICON_CLASS,
    textCls: EMOJI_ICON_TEXT_CLASS,
    svg: EMOJI_ICON_SVG_ATTRIBUTES,
    skip: EMOJI_ICON_SKIP_TAGS,
  }).replace(/</g, '\\u003c');
  return `<style data-piwin-emoji-icons>${EMOJI_ICON_CSS}</style>
  <script data-piwin-emoji-icons>${EMOJI_ICON_RUNTIME.replace('__CONFIG__', config)}</script>`;
}

/** Browser runtime; mirrors `resolveEmojiIcon` + `replaceEmojiIconsInTree`. */
const EMOJI_ICON_RUNTIME = `(function(){try{
var C=__CONFIG__,NS='http://www.w3.org/2000/svg';
var FOLD=new RegExp(C.fold,'gu'),PRES=/^\\p{Emoji_Presentation}/u;
function resolve(e){if(e.indexOf('\\uFE0E')>=0)return null;
if(!(e.indexOf('\\uFE0F')>=0||e.indexOf('\\u200D')>=0||PRES.test(e)))return null;
var i=C.names[e.replace(FOLD,'')];return i&&C.glyphs[i]?i:null;}
function skipped(el){for(;el;el=el.parentElement){var t=el.localName;
if(C.skip.indexOf(t)>=0)return true;
if(el.classList&&(el.classList.contains(C.cls)||el.classList.contains('katex')))return true;
var ce=el.getAttribute&&el.getAttribute('contenteditable');if(ce!==null&&ce!==undefined&&ce!=='false')return true;}return false;}
function icon(e,n){var s=document.createElement('span');s.className=C.cls;s.setAttribute('data-emoji-icon',n);
var v=document.createElementNS(NS,'svg');for(var k in C.svg)if(k!=='xmlns')v.setAttribute(k,C.svg[k]);
C.glyphs[n].forEach(function(g){var p=document.createElementNS(NS,g[0]);for(var a in g[1])p.setAttribute(a,g[1][a]);v.appendChild(p);});
var t=document.createElement('span');t.className=C.textCls;t.textContent=e;s.appendChild(v);s.appendChild(t);return s;}
function fix(node){var re=new RegExp(C.seq,'gu'),d=node.data,m,cur=0,f=null;
while((m=re.exec(d))){var n=resolve(m[0]);if(!n)continue;f=f||document.createDocumentFragment();
if(m.index>cur)f.appendChild(document.createTextNode(d.slice(cur,m.index)));f.appendChild(icon(m[0],n));cur=m.index+m[0].length;}
if(!f)return;if(cur<d.length)f.appendChild(document.createTextNode(d.slice(cur)));node.parentNode.replaceChild(f,node);}
function scan(root){if(!root)return;if(root.nodeType===3){if(!skipped(root.parentElement))fix(root);return;}
var w=document.createTreeWalker(root,4),list=[],n;while((n=w.nextNode()))if(!skipped(n.parentElement))list.push(n);list.forEach(fix);}
var busy=false;function run(muts){if(busy)return;busy=true;try{if(!muts){scan(document.body);}else{muts.forEach(function(m){
if(m.type==='characterData')scan(m.target);else m.addedNodes.forEach(function(a){if(a.isConnected)scan(a);});});}}finally{busy=false;}}
function start(){run();new MutationObserver(run).observe(document.documentElement,{childList:true,subtree:true,characterData:true});}
if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
}catch(e){}})();`;

