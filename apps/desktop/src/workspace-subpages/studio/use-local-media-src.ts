import { useCallback, useEffect, useState } from 'react';

function tauriConvertFileSrc(): ((path: string) => string) | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { convertFileSrc?: (assetPath: string) => string };
    }
  ).__TAURI_INTERNALS__;
  return typeof internals?.convertFileSrc === 'function' ? internals.convertFileSrc : null;
}

/**
 * Resolves vault paths to Tauri asset URLs. Reads convertFileSrc synchronously
 * when the Tauri internals are already on window so the first gallery paint
 * does not fall through to a full-file host read.
 */
export function useLocalMediaSrc(): (localPath: string, fallbackUrl: string) => string {
  const [convert, setConvert] = useState<((path: string) => string) | null>(tauriConvertFileSrc);

  useEffect(() => {
    if (convert !== null) {
      return;
    }
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
  }, [convert]);

  return useCallback(
    (localPath: string, fallbackUrl: string) =>
      convert !== null ? convert(localPath) : fallbackUrl,
    [convert],
  );
}
