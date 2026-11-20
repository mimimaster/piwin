/**
 * Zero-dependency registry of active or starting xterm PTY sessions.
 *
 * Kept separate from `xterm-surface.tsx` so cold-start shell code
 * (`workbench-app.tsx`) can check live PTY ownership without pulling
 * `@xterm/xterm` into the initial bundle.
 */
const activePtyTokens = new Set<symbol>();

/** Register a live/starting PTY token and return an idempotent release callback. */
export function registerLivePtyToken(): () => void {
  const token = Symbol('xterm-pty');
  activePtyTokens.add(token);
  return () => {
    activePtyTokens.delete(token);
  };
}

/** True while at least one terminal surface owns an active or starting PTY. */
export function hasLiveXtermPty(): boolean {
  return activePtyTokens.size > 0;
}
