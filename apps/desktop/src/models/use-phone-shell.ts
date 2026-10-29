import { useEffect, useState } from 'react';
import { PHONE_SHELL_MAX_WIDTH } from '../tool-cards/shell-layout';

/** True while the workbench renders its phone layout (same breakpoint as useShellLayout). */
export function usePhoneShell(): boolean {
  const query = `(max-width: ${PHONE_SHELL_MAX_WIDTH}px)`;
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const sync = (): void => setPhone(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [query]);
  return phone;
}

/** Send-time check for the phone layout (no React state needed). */
export function isPhoneShellViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(max-width: ${PHONE_SHELL_MAX_WIDTH}px)`).matches
  );
}
