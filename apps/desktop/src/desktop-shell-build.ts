/** True when this Desktop was built as a thin shell (no local Host sidecar). */
export function isDesktopShellOnlyBuild(): boolean {
  return import.meta.env.VITE_PIWIN_SHELL_ONLY === '1';
}

/**
 * WebSocket the connect wall offers first. A deployed page sets this at build
 * time; an already saved target still wins.
 */
export function desktopShellDefaultEndpoint(): string | undefined {
  const raw = import.meta.env.VITE_PIWIN_HOST_ENDPOINT?.trim();
  return raw === undefined || raw.length === 0 ? undefined : raw;
}