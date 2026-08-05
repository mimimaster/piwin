/** Base64 media payload validation for media/save. */
export function decodeBase64Media(base64Data: string): Uint8Array {
  const normalized = base64Data.replace(/\s/g, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error('media payload must be valid base64');
  }

  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0) {
    throw new Error('media payload is empty');
  }
  return bytes;
}
