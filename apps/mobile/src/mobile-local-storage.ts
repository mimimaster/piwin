/**
 * The WebView's `localStorage`, or undefined where it is unavailable (private
 * mode, blocked site data, tests). Only for per-device conveniences — never
 * for secrets (see mobile-device-credential-vault.ts) or Host authority.
 */
export function mobileLocalStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}
