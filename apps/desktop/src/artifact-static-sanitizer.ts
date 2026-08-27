import DOMPurify, { type Config } from 'dompurify';

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

const SVG_ROOT_WRAP_ATTR = 'data-piwin-svg-root-wrap';

/**
 * DOMPurify (especially under happy-dom) unwraps a bare `<svg>` document into
 * its children, which destroys the SVG namespace and breaks `<use>`/geometry.
 * Temporarily wrap a sole SVG root so purify keeps the element intact.
 */
function protectSoleSvgRoot(html: string): string {
  const trimmed = html.trim();
  if (!/^<svg(\s|>)/i.test(trimmed)) return html;
  return `<div ${SVG_ROOT_WRAP_ATTR}="1">${html}</div>`;
}

function unwrapProtectedSvgRoot(root: DocumentFragment): void {
  const wrap = root.querySelector(`:scope > div[${SVG_ROOT_WRAP_ATTR}]`);
  if (wrap === null) return;
  wrap.replaceWith(...wrap.childNodes);
}

/**
 * Sanitize static Artifact markup for insertion into Desktop's Shadow DOM.
 * The explicit DOM pass keeps behavior deterministic in WebKit and test DOMs;
 * DOMPurify then provides a second independent HTML/SVG sanitizer.
 */
export function sanitizeStaticArtifactSource(source: string): string {
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

  const purified = DOMPurify.sanitize(protectSoleSvgRoot(template.innerHTML), PURIFY_OPTIONS);
  const purifiedTemplate = document.createElement('template');
  purifiedTemplate.innerHTML = purified;
  unwrapProtectedSvgRoot(purifiedTemplate.content);
  expandLocalSvgUseReferences(purifiedTemplate.content);
  normalizeStaticSvgRootSizing(purifiedTemplate.content);
  for (const css of styleBlocks) {
    const style = document.createElement('style');
    style.textContent = css;
    purifiedTemplate.content.append(style);
  }
  return purifiedTemplate.innerHTML;
}
