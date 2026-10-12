/**
 * The Host hands a model each prompt image as `<attached_image path=… />`
 * (contracts `media.ts`). That is model input, not prose: when a reply quotes
 * it back (the mock echoes it verbatim), the transcript shows a short marker
 * instead of a Host-internal path. The image itself is drawn from the turn's
 * attachments.
 */
const ATTACHED_IMAGE = /<attached_image\b[^>]*?\/>/g;
/** A tag still streaming in: hidden until it closes. */
const PARTIAL_TAIL = /<attached_image\b[^>]*$/;

export function replaceAttachedImageMarkup(text: string): string {
  if (!text.includes('<attached_image')) return text;
  return text.replace(ATTACHED_IMAGE, (tag) => {
    const filePath = /\bpath="([^"]*)"/.exec(tag)?.[1] ?? '';
    const name = filePath.split(/[\\/]/).pop() ?? '';
    return name === '' ? '[图片]' : `[图片 ${name}]`;
  }).replace(PARTIAL_TAIL, '');
}
