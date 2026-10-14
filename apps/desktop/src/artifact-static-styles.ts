/** Authorize already-sanitized static Artifact CSS under the packaged host CSP. */
export function authorizeStaticArtifactStyles(
  baseStyle: HTMLStyleElement,
  content: HTMLElement,
): void {
  // Tauri assigns a fresh nonce to this trusted boot style in the app's head.
  // Attribute reads hide nonces in browsers; use the nonce property instead.
  const nonce = document.head.querySelector<HTMLStyleElement>('style#boot-splash-style')?.nonce;
  if (!nonce) return;

  baseStyle.nonce = nonce;
  for (const style of content.querySelectorAll<HTMLStyleElement>('style')) {
    style.nonce = nonce;
  }

  // A nonce authorizes style blocks, never style attributes. Apply only the
  // sanitizer's surviving HTML/SVG declarations through individual CSSOM
  // properties; the host CSP and untrusted-source policy stay in force.
  for (const element of content.querySelectorAll<HTMLElement | SVGElement>('[style]')) {
    const declarations = document.createElement('span').style;
    declarations.cssText = element.getAttribute('style') ?? '';
    element.removeAttribute('style');
    for (const property of Array.from(declarations)) {
      element.style.setProperty(
        property,
        declarations.getPropertyValue(property),
        declarations.getPropertyPriority(property),
      );
    }
  }
}
