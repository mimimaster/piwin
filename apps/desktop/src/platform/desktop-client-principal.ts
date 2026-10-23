const STORAGE_KEY = 'piwin.desktop.clientPrincipalId';

let memoryPrincipalId: string | undefined;

/** Stable Desktop installation principal for local JSONL idempotency. */
export function readDesktopClientPrincipalId(): string {
  if (memoryPrincipalId !== undefined) {
    return memoryPrincipalId;
  }
  try {
    const existing = globalThis.localStorage?.getItem(STORAGE_KEY)?.trim();
    if (existing !== undefined && existing.length > 0) {
      memoryPrincipalId = existing;
      return existing;
    }
    const created = createPrincipalId();
    globalThis.localStorage?.setItem(STORAGE_KEY, created);
    memoryPrincipalId = created;
    return created;
  } catch {
    memoryPrincipalId = createPrincipalId();
    return memoryPrincipalId;
  }
}

function createPrincipalId(): string {
  const cryptoObject = (
    globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  ).crypto;
  if (cryptoObject?.randomUUID !== undefined) {
    return cryptoObject.randomUUID();
  }
  return `desktop-${Date.now().toString(36)}`;
}
