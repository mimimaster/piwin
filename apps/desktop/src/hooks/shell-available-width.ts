/** Width left for shell columns after the document's horizontal safe areas. */
export function readShellAvailableWidth(view: Window): number {
  const style = view.getComputedStyle(view.document.documentElement);
  const left = Number.parseFloat(style.paddingLeft) || 0;
  const right = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(0, view.innerWidth - Math.max(0, left) - Math.max(0, right));
}
