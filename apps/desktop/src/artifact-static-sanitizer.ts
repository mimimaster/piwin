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
const PURIFY_OPTIONS: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: [...FORBIDDEN_STATIC_TAGS],
  FORBID_ATTR: [...FORBIDDEN_ATTRIBUTE_NAMES],
};

function isSafeStaticUrl(attributeName: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if ((attributeName === 'href' || attributeName === 'xlink:href') && SAFE_FRAGMENT_URL_PATTERN.test(trimmed)) {
    return true;
  }
  return attributeName === 'src' && SAFE_DATA_IMAGE_PATTERN.test(trimmed);
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

  const purified = DOMPurify.sanitize(template.innerHTML, PURIFY_OPTIONS);
  const purifiedTemplate = document.createElement('template');
  purifiedTemplate.innerHTML = purified;
  for (const css of styleBlocks) {
    const style = document.createElement('style');
    style.textContent = css;
    purifiedTemplate.content.append(style);
  }
  return purifiedTemplate.innerHTML;
}
