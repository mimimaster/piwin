/**
 * Leased cache for object URLs of vault media read back through the Host.
 *
 * A blob URL pins its bytes (an original image, or a whole generated video)
 * until it is revoked, so the cache may only keep what is on screen plus a
 * small idle tail. Consumers acquire a lease per read and hand the URL back
 * when they unmount; a URL nobody leases stays warm for scroll-back and is
 * revoked once it falls out of the idle tail.
 */
export const MAX_IDLE_MEDIA_PREVIEW_URLS = 6;

type LeasedUrl = { url: string; leases: number };

/** Insertion order doubles as idle recency: a released entry moves to the end. */
const entriesByKey = new Map<string, LeasedUrl>();
const keysByUrl = new Map<string, string>();
const inflightByKey = new Map<string, Promise<string | null>>();

function revokeIdleOverflow(): void {
  const idleKeys: string[] = [];
  for (const [key, entry] of entriesByKey) {
    if (entry.leases === 0) idleKeys.push(key);
  }
  const overflow = idleKeys.length - MAX_IDLE_MEDIA_PREVIEW_URLS;
  for (const key of idleKeys.slice(0, Math.max(0, overflow))) {
    const entry = entriesByKey.get(key);
    if (entry === undefined) continue;
    entriesByKey.delete(key);
    keysByUrl.delete(entry.url);
    URL.revokeObjectURL(entry.url);
  }
}

/**
 * Lease the object URL for `key`, loading it once however many callers ask
 * concurrently. Every non-null result must be returned through
 * `releaseMediaPreviewUrl`.
 */
export async function acquireMediaPreviewUrl(
  key: string,
  load: () => Promise<string | null>,
): Promise<string | null> {
  if (!entriesByKey.has(key)) {
    let pending = inflightByKey.get(key);
    if (pending === undefined) {
      pending = load()
        .then((url) => {
          if (url !== null) {
            entriesByKey.set(key, { url, leases: 0 });
            keysByUrl.set(url, key);
          }
          return url;
        })
        .finally(() => {
          inflightByKey.delete(key);
        });
      inflightByKey.set(key, pending);
    }
    if ((await pending) === null) {
      return null;
    }
  }
  const entry = entriesByKey.get(key);
  if (entry === undefined) {
    // Revoked between load and lease; the caller treats it as a miss.
    return null;
  }
  entry.leases += 1;
  return entry.url;
}

/** Hand a leased URL back. URLs this cache did not issue are ignored. */
export function releaseMediaPreviewUrl(url: string | null | undefined): void {
  if (!url) return;
  const key = keysByUrl.get(url);
  if (key === undefined) return;
  const entry = entriesByKey.get(key);
  if (entry === undefined || entry.leases === 0) return;
  entry.leases -= 1;
  if (entry.leases > 0) return;
  entriesByKey.delete(key);
  entriesByKey.set(key, entry);
  revokeIdleOverflow();
}

export function resetMediaPreviewUrlCacheForTests(): void {
  entriesByKey.clear();
  keysByUrl.clear();
  inflightByKey.clear();
}
