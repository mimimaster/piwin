/**
 * Choose which tools a Pi session exposes from a compiled session tool policy.
 *
 * Pi's `createAgentSession({ tools })` is a **global** allowlist: it filters
 * built-ins, `customTools` AND tools that Pi Extensions register through
 * `pi.registerTool` (see pi-coding-agent `_refreshToolRegistry`). Extension
 * tool names are only known after the extension runs (often inside its
 * `session_start` handler), so an allowlist compiled by the Host silently
 * drops every extension tool before the model sees it.
 *
 * Instead we pass `excludeTools` naming only the Pi-native tools the policy
 * does not grant. Host tools stay exact because they are the only
 * `customTools` injected, and extension tools pass through. The load-time
 * extension policy (trust, disabled ids) decides which extensions run.
 */

/**
 * Tool names Pi's `createAllToolDefinitions` registers (pi-coding-agent
 * 0.84.x). Not exported from the package root, so mirrored here; the
 * characterization test fails if Pi adds one.
 */
export const PI_NATIVE_TOOL_NAMES: readonly string[] = [
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
];

export type PiSessionToolSelectionInput = {
  piBuiltinToolNames: readonly string[];
  hostTools: readonly { name: string }[];
};

/**
 * Pi-native tool names to exclude. A name that a Host tool reuses (e.g. the
 * Host-owned `bash`) is kept, because Pi applies `excludeTools` to
 * `customTools` too and the Host registration overrides the native one.
 */
export function buildPiSessionExcludedToolNames(input: PiSessionToolSelectionInput): string[] {
  const kept = new Set<string>(input.piBuiltinToolNames);
  for (const hostTool of input.hostTools) {
    kept.add(hostTool.name);
  }
  return PI_NATIVE_TOOL_NAMES.filter((name) => !kept.has(name));
}

type PiToolActivationSession = {
  getActiveToolNames: () => string[];
  setActiveToolsByName: (toolNames: string[]) => void;
};

/**
 * Without a `tools` allowlist Pi only activates its default native set
 * (read/bash/edit/write) plus custom and extension tools. Activate the
 * granted Pi built-ins (grep/ls/…) on top. Later extension registrations are
 * activated by Pi itself as new registry entries.
 */
export function activatePiBuiltinTools(
  session: unknown,
  piBuiltinToolNames: readonly string[],
): void {
  if (!isToolActivationSession(session) || piBuiltinToolNames.length === 0) {
    return;
  }
  const active = session.getActiveToolNames();
  session.setActiveToolsByName([...new Set([...active, ...piBuiltinToolNames])]);
}

function isToolActivationSession(session: unknown): session is PiToolActivationSession {
  const candidate = session as Partial<PiToolActivationSession> | null;
  return (
    typeof candidate?.getActiveToolNames === 'function' &&
    typeof candidate.setActiveToolsByName === 'function'
  );
}
