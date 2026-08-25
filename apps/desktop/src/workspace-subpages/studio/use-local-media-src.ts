import { useEffect, useState } from 'react';

/**
 * Resolves `localPath` fields to renderable asset URLs via Tauri's asset
 * protocol. Outside Tauri (tests, browser dev) the fallback URL is used.
 * This is the seam real media listing will plug into: items carrying a
 * `localPath` under ~/.piwin/media render from disk automatically.
 */
export function useLocalMediaSrc(): (localPath: string, fallbackUrl: string) => string {
  const [convert, setConvert] = useState<
    ((path: string) => string) | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void import('@tauri-apps/api/core')
      .then((core) => {
        if (!cancelled && typeof core.convertFileSrc === 'function') {
          setConvert(() => core.convertFileSrc);
        }
      })
      .catch(() => {
        // Non-tauri environment — keep URL fallbacks.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (localPath: string, fallbackUrl: string) =>
    convert !== null ? convert(localPath) : fallbackUrl;
}
