/**
 * Viewport-space top of what the reader can see in a transcript scrollport.
 *
 * On a phone the scrollport runs up under the glass titleband and reserves
 * that strip with `scroll-padding-top` (region-phone-glass.css). Anything that
 * asks "what is at the top of the screen" must start below it, or it picks a
 * row hidden behind the bar. Everywhere else the inset is 0 and this is the
 * scrollport's own top.
 */
export function transcriptVisibleTop(container: HTMLElement): number {
  const inset = Number.parseFloat(getComputedStyle(container).scrollPaddingTop);
  return container.getBoundingClientRect().top + (Number.isFinite(inset) ? inset : 0);
}
