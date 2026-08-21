/** True when this Desktop was built as a thin shell (no local Host sidecar). */
export function isDesktopShellOnlyBuild(): boolean {
  return import.meta.env.VITE_PIWIN_SHELL_ONLY === '1';
}
