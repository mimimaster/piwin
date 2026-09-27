/**
 * Narrowing guard for untrusted wire payloads.
 *
 * Lives in its own leaf module so remote command validation, media-ref
 * bookkeeping, and hydration can share it without importing one another.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
