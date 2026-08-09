import {
  contentKindForMimeType,
  type AttachmentContentKind,
  type SaveMediaInput,
} from '@piwin/contracts';

const MAX_SECRET_SCAN_BYTES = 64 * 1024;

const BLOCKED_ATTACHMENT_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  'credentials.json',
  'kubeconfig',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
]);

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u;
const CREDENTIAL_PATTERN =
  /(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|password)\s*[:=]\s*['"]?[^\s'"`]{12,}/iu;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/u;

export class UnsafeAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeAttachmentError';
  }
}

/** Reject obvious credential files before they become model context. */
export function assertAttachmentPayloadSafe(
  input: Pick<SaveMediaInput, 'bytes' | 'mimeType' | 'name' | 'source'> & {
    contentKind?: AttachmentContentKind;
  },
): void {
  if (input.source === 'generated') {
    return;
  }

  const name = input.name?.trim().toLowerCase() ?? '';
  if (BLOCKED_ATTACHMENT_NAMES.has(name) || name.endsWith('.pem') || name.endsWith('.p12')) {
    throw new UnsafeAttachmentError(
      `attachment blocked because it may contain credentials: ${input.name ?? 'unnamed file'}`,
    );
  }

  const contentKind = input.contentKind ?? contentKindForMimeType(input.mimeType);
  if (contentKind !== 'text') {
    return;
  }

  const sample = new TextDecoder().decode(input.bytes.subarray(0, MAX_SECRET_SCAN_BYTES));
  if (
    PRIVATE_KEY_PATTERN.test(sample) ||
    CREDENTIAL_PATTERN.test(sample) ||
    AWS_ACCESS_KEY_PATTERN.test(sample)
  ) {
    throw new UnsafeAttachmentError(
      `attachment blocked because it appears to contain secret material: ${input.name ?? 'unnamed file'}`,
    );
  }
}
