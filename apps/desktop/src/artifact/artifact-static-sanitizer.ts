import type { Config } from 'dompurify';

type DomPurifyApi = typeof import('dompurify').default;

let domPurify: DomPurifyApi | null = null;
let domPurifyLoad: Promise<DomPurifyApi> | null = null;

async function loadDomPurify(): Promise<DomPurifyApi> {
  if (domPurify) return domPurify;
  if (!domPurifyLoad) {
    domPurifyLoad = import('dompurify').then((module) => {
      domPurify = module.default;
      return domPurify;
    });
  }
  return domPurifyLoad;
}

const FORBIDDEN_STATIC_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'form',
  'base',
  'meta',
  'link',
  'template',
] as const;

const URL_ATTRIBUTE_NAMES = new Set([
  'action',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'srcset',
  'xlink:href',
]);
const FORBIDDEN_ATTRIBUTE_NAMES = new Set([
  'autofocus',
  'contenteditable',
  'formaction',
  'popover',
  'popovertarget',
  'commandfor',
  'srcdoc',
]);
const UNSAFE_CSS_PATTERN =
  /@import\b|(?:https?:)?\/\/|(?:java|vb)script\s*:|data\s*:\s*text\/html|expression\s*\(|behavior\s*:|-moz-binding\s*:|:host(?:-context)?(?:\s|\()/i;
const SAFE_FRAGMENT_URL_PATTERN = /^#[A-Za-z_][\w:.-]*$/;
const SAFE_DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SVG_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const PURIFY_OPTIONS: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: [...FORBIDDEN_STATIC_TAGS],
  FORBID_ATTR: [...FORBIDDEN_ATTRIBUTE_NAMES],
};

function isSafeStaticUrl(attributeName: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (
    (attributeName === 'href' || attributeName === 'xlink:href') &&
    SAFE_FRAGMENT_URL_PATTERN.test(trimmed)
  ) {
    return true;
  }
  return attributeName === 'src' && SAFE_DATA_IMAGE_PATTERN.test(trimmed);
}

function findFragmentTarget(root: DocumentFragment, fragmentId: string): Element | undefined {
  return [...root.querySelectorAll<HTMLElement>('[id]')].find(
    (element) => element.getAttribute('id') === fragmentId,
  );
}

function cloneSvgUseTarget(target: Element): Element {
  if (target.localName !== 'symbol') {
    const clone = target.cloneNode(true) as Element;
    clone.removeAttribute('id');
    return clone;
  }

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  for (const attribute of [...target.attributes]) {
    if (attribute.name.toLowerCase() === 'id') continue;
    svg.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  svg.append(...[...target.childNodes].map((child) => child.cloneNode(true)));
  return svg;
}

/**
 * WebKit does not consistently resolve SVG `<use href="#…">` instances from
 * inside a ShadowRoot. Expand only already-sanitized, same-fragment targets so
 * static SVGs render identically without weakening the external URL policy.
 */
function expandLocalSvgUseReferences(root: DocumentFragment): void {
  const uses = [...root.querySelectorAll<SVGUseElement>('use')];
  for (const use of uses) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
    if (href === null || !SAFE_FRAGMENT_URL_PATTERN.test(href.trim())) continue;
    const target = findFragmentTarget(root, href.trim().slice(1));
    if (target === undefined || target === use) continue;

    const instance = document.createElementNS(SVG_NAMESPACE, 'g');
    for (const attribute of [...use.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === 'href' || name === 'xlink:href' || name === 'x' || name === 'y') continue;
      instance.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }

    const x = use.getAttribute('x')?.trim() ?? '';
    const y = use.getAttribute('y')?.trim() ?? '';
    if ((x && SVG_NUMBER_PATTERN.test(x)) || (y && SVG_NUMBER_PATTERN.test(y))) {
      const translate = `translate(${x && SVG_NUMBER_PATTERN.test(x) ? x : '0'} ${
        y && SVG_NUMBER_PATTERN.test(y) ? y : '0'
      })`;
      const transform = instance.getAttribute('transform')?.trim();
      instance.setAttribute('transform', transform ? `${transform} ${translate}` : translate);
    }

    instance.append(cloneSvgUseTarget(target));
    use.replaceWith(instance);
  }
}

/**
 * Model SVGs often ship `width="100%" height="100%"`. Inside a naturally sized
 * transcript card that percentage height can stretch the frame into empty
 * vertical space. Prefer the viewBox aspect ratio for top-level SVGs.
 */
function normalizeStaticSvgRootSizing(root: DocumentFragment): void {
  for (const svg of root.querySelectorAll('svg')) {
    if (!(svg instanceof Element)) continue;
    let ancestor = svg.parentElement;
    let nestedInSvg = false;
    while (ancestor) {
      if (ancestor.localName === 'svg') {
        nestedInSvg = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nestedInSvg) continue;
    if (!svg.getAttribute('viewBox')?.trim()) continue;
    const height = svg.getAttribute('height')?.trim() ?? '';
    if (height.endsWith('%')) {
      svg.removeAttribute('height');
    }
  }
}

const ROOT_WRAP_ATTR = 'data-piwin-root-wrap';

/**
 * DOMPurify (especially under happy-dom) unwraps a document that is a single
 * root element into that element's children. For a bare `<svg>` that destroys
 * the SVG namespace and breaks `<use>`/geometry; for a Report Kit document it
 * drops the `piwin-report` root every kit style hangs from. The markup is
 * wrapped for the sanitizer's pass so whatever the author wrote at the top
 * level stays an element.
 */
function protectTopLevelMarkup(html: string): string {
  return `<div ${ROOT_WRAP_ATTR}="1">${html}</div>`;
}

function unwrapProtectedMarkup(root: DocumentFragment): void {
  // Not `:scope >`: a DocumentFragment is not an element, and browsers match
  // nothing for `:scope` there — the wrapper would stay in the output.
  const wrap = Array.from(root.children).find(
    (child) => child.tagName === 'DIV' && child.hasAttribute(ROOT_WRAP_ATTR),
  );
  if (wrap === undefined) return;
  wrap.replaceWith(...wrap.childNodes);
}

/**
 * Sanitize static Artifact markup for insertion into Desktop's Shadow DOM.
 * The explicit DOM pass keeps behavior deterministic in WebKit and test DOMs;
 * DOMPurify then provides a second independent HTML/SVG sanitizer.
 */
export async function sanitizeStaticArtifactSource(source: string): Promise<string> {
  return sanitizeWithPurifier(await loadDomPurify(), source);
}

/** Starts loading the sanitizer so the first static Artifact can paint at once. */
export function preloadStaticArtifactSanitizer(): void {
  void loadDomPurify().catch(() => undefined);
}

/**
 * Sanitized markup without waiting, or null while the sanitizer is still
 * loading. An Artifact that mounts empty and fills in a moment later paints
 * one frame at a few pixels tall: the transcript below it jumps up by the
 * Artifact's whole height and back. That happens each time a finished stream
 * hands over to the static renderer and each time a virtualized row remounts.
 */
export function sanitizeStaticArtifactSourceNow(source: string): string | null {
  if (!domPurify) return null;
  const cached = sanitizedSourceCache.get(source);
  if (cached !== undefined) {
    // Refresh recency.
    sanitizedSourceCache.delete(source);
    sanitizedSourceCache.set(source, cached);
    return cached;
  }
  const sanitized = sanitizeWithPurifier(domPurify, source);
  if (source.length <= MAX_CACHED_SOURCE_CHARS) {
    sanitizedSourceCache.set(source, sanitized);
    if (sanitizedSourceCache.size > MAX_CACHED_SOURCES) {
      const oldest = sanitizedSourceCache.keys().next().value;
      if (oldest !== undefined) sanitizedSourceCache.delete(oldest);
    }
  }
  return sanitized;
}

/** Rows remount as the transcript scrolls; their markup need not be re-sanitized. */
const MAX_CACHED_SOURCES = 32;
const MAX_CACHED_SOURCE_CHARS = 64 * 1024;
const sanitizedSourceCache = new Map<string, string>();

function sanitizeWithPurifier(purify: DomPurifyApi, source: string): string {
  const template = document.createElement('template');
  template.innerHTML = source;
  template.content.querySelectorAll(FORBIDDEN_STATIC_TAGS.join(',')).forEach((element) => {
    element.remove();
  });

  const styleBlocks: string[] = [];
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on') ||
        FORBIDDEN_ATTRIBUTE_NAMES.has(name) ||
        (URL_ATTRIBUTE_NAMES.has(name) && !isSafeStaticUrl(name, attribute.value)) ||
        (name === 'style' && UNSAFE_CSS_PATTERN.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element.tagName === 'STYLE') {
      const css = element.textContent ?? '';
      if (UNSAFE_CSS_PATTERN.test(css)) {
        element.remove();
        return;
      }
      styleBlocks.push(css);
      element.remove();
    }
  });

  // WebKit's DOMPurify path may discard the local href from SVG <use> even
  // though the fragment is safe. Materialize those instances after the
  // explicit attribute pass and before DOMPurify so the sanitizer sees only
  // ordinary SVG geometry. The cloned geometry is still purified below.
  expandLocalSvgUseReferences(template.content);

  const purified = purify.sanitize(protectTopLevelMarkup(template.innerHTML), PURIFY_OPTIONS);
  const purifiedTemplate = document.createElement('template');
  purifiedTemplate.innerHTML = purified;
  unwrapProtectedMarkup(purifiedTemplate.content);
  expandLocalSvgUseReferences(purifiedTemplate.content);
  normalizeStaticSvgRootSizing(purifiedTemplate.content);
  for (const css of styleBlocks) {
    const style = document.createElement('style');
    style.textContent = css;
    purifiedTemplate.content.append(style);
  }
  return purifiedTemplate.innerHTML;
}
