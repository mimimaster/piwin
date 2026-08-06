/**
 * Build the Pi `createAgentSession({ tools })` allowlist from a compiled
 * session tool policy.
 *
 * Pi treats `tools` as a **global** allowlist for both built-ins and
 * `customTools` (see pi-coding-agent `_refreshToolRegistry`). Product host
 * tools (bash, write_file, web_*, mcp_*, …) are injected only as customTools
 * and must therefore appear in this list, or Pi drops them before the model
 * ever sees them.
 *
 * `piBuiltinToolNames` alone is intentionally narrow (read/grep/ls) so Pi
 * native write/bash/edit stay off; host-owned replacements live in
 * `hostTools` and must be unioned here.
 */

export type PiSessionToolAllowlistInput = {
  piBuiltinToolNames: readonly string[];
  hostTools: readonly { name: string }[];
};

/**
 * Union Pi built-in names with Host custom tool names, preserving first-seen
 * order (built-ins first, then host tools in descriptor order).
 */
export function buildPiSessionToolAllowlist(
  input: PiSessionToolAllowlistInput,
): string[] {
  const allowlist: string[] = [];
  const seen = new Set<string>();

  for (const toolName of input.piBuiltinToolNames) {
    if (seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    allowlist.push(toolName);
  }

  for (const hostTool of input.hostTools) {
    const toolName = hostTool.name;
    if (seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    allowlist.push(toolName);
  }

  return allowlist;
}
