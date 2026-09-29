/**
 * Pi `ImageContent` as consumed by `AgentSession.prompt(text, { images })`.
 *
 * Pi pushes these parts verbatim into the user message, and providers select
 * images by `type === 'image'`. Omitting `type` makes providers silently drop
 * the attachment, so every Pi-bound image must go through this converter.
 */
export type PiImageContent = { type: 'image'; data: string; mimeType: string };

/** Product/transport image shape (`@piwin/contracts` base64 payload). */
export type Base64ImageInput = { dataBase64: string; mimeType: string };

export function toPiImageContents(
  images: ReadonlyArray<Base64ImageInput>,
): PiImageContent[] {
  return images.map((image) => ({
    type: 'image',
    data: image.dataBase64,
    mimeType: image.mimeType,
  }));
}
