/** Snapshot at send time: no observer, retained DOM references, or resize-triggered prompts. */
export function readInlineArtifactWidth(sessionId: string | null | undefined): number | undefined {
  if (typeof document === 'undefined') return undefined;
  const widths: number[] = [];
  for (const root of document.querySelectorAll<HTMLElement>(
    '[data-artifact-layout-session], [data-artifact-layout-root="main"]',
  )) {
    if (sessionId !== undefined && sessionId !== null) {
      if (root.dataset.artifactLayoutSession !== sessionId) continue;
    } else if (root.dataset.artifactLayoutRoot !== 'main') {
      // A new conversation has no session id yet. Only use the explicitly
      // marked main transcript; never infer a width from a side surface.
      continue;
    }
    const column = root.querySelector<HTMLElement>('.chat-thread') ?? root;
    const style = getComputedStyle(column);
    const width = column.clientWidth - (parseFloat(style.paddingLeft) || 0)
      - (parseFloat(style.paddingRight) || 0);
    if (Number.isFinite(width) && width > 0) widths.push(Math.round(width));
  }
  // The same session may be visible twice. The narrower presentation is the safe reference.
  return widths.length > 0 ? Math.min(...widths) : undefined;
}

/** Resolved host mode at send time; absent when the shell has not projected one yet. */
export function readArtifactHostTheme(): 'light' | 'dark' | undefined {
  if (typeof document === 'undefined') return undefined;
  const mode = document.documentElement.dataset.themeMode;
  return mode === 'light' || mode === 'dark' ? mode : undefined;
}
