import type { PromptInput } from '@piwin/contracts';
import type { ModelPromptAssembly } from '../model-context-assembly.js';

/**
 * Records what the model actually received (native image, injected text, web
 * element) so the assembly capsule explains the prompt without re-deriving it.
 */

function isImageAttachment(attachment: NonNullable<PromptInput['attachments']>[number]): boolean {
  return (
    attachment.kind === 'media' &&
    (attachment.contentKind === 'image' ||
      (attachment.contentKind === undefined &&
        attachment.mimeType.toLowerCase().startsWith('image/')))
  );
}

export function collectPreparedAttachmentContributions(
  assembly: ModelPromptAssembly,
  original: PromptInput,
  prepared: PromptInput,
): void {
  const originalAttachments = original.attachments ?? [];
  for (const attachment of originalAttachments) {
    if (attachment.kind === 'media') {
      assembly.add({
        kind: isImageAttachment(attachment) ? 'native-image' : 'attachment-text',
        label: attachment.mimeType,
        trustOrigin: 'user',
        hostPath: attachment.path,
      });
    } else {
      assembly.add({
        kind: 'web-element',
        label: 'Web element',
        trustOrigin: 'external-web',
        text: attachment.text,
      });
    }
  }
  if (prepared.text === original.text) {
    return;
  }
  const injected = prepared.text.endsWith(original.text)
    ? prepared.text.slice(0, Math.max(0, prepared.text.length - original.text.length)).trim()
    : prepared.text.startsWith(original.text)
      ? prepared.text.slice(original.text.length).trim()
      : '';
  if (injected.length === 0) {
    return;
  }
  const preparedKeptNativeImage =
    prepared.attachments?.some((attachment) => isImageAttachment(attachment)) === true;
  const hadImage = originalAttachments.some((attachment) => isImageAttachment(attachment));
  assembly.add({
    kind: hadImage && !preparedKeptNativeImage ? 'vision-description' : 'attachment-text',
    label: hadImage && !preparedKeptNativeImage ? 'Vision / path injection' : 'Attachment text',
    trustOrigin: 'piwin',
    text: injected,
  });
}
