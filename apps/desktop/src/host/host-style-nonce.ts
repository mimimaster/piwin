/**
 * Nonce that lets a runtime `<style>` element pass the packaged host CSP.
 *
 * Tauri adds a fresh `'nonce-…'` to `style-src` because `index.html` ships the
 * inline `boot-splash-style`; once a nonce is present, browsers ignore
 * `'unsafe-inline'`, so any `<style>` created later is dropped unless it
 * carries the same nonce. Returns undefined in dev / tests (no nonce issued,
 * `'unsafe-inline'` still applies).
 */
export function readHostStyleNonce(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  // Attribute reads hide nonces in browsers; use the nonce property instead.
  const nonce = document.head.querySelector<HTMLStyleElement>('style#boot-splash-style')?.nonce;
  return nonce ? nonce : undefined;
}
