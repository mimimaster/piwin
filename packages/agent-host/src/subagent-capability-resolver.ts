/**
 * CE-SUB-PROF: map product capabilities to concrete Pi/native/custom tool ids.
 *
 * This is the only place that translates `SubagentCapability` values into
 * concrete tool names. Settings never sees Pi tool names. The permission
 * engine still evaluates each concrete action at runtime; capability
 * resolution only removes unavailable tools before the model can call them.
 */

import type { SubagentCapability } from '@piwin/contracts';

/**
 * Concrete Pi/native/custom tool names mapped from product capabilities.
 * This is the internal allowlist passed to Pi SDK `createAgentSession({ tools })`.
 */
export type SubagentToolAllowlist = {
  /** Pi built-in tool names (e.g. 'read', 'grep', 'bash'). */
  piToolNames: string[];
  /** Host-owned custom tool names (e.g. 'piwin_subagent_run', 'web_search'). */
  customToolNames: string[];
};

/** Default capability → tool mapping. Host may extend this at wiring time. */
const CAPABILITY_TOOLS: Record<SubagentCapability, SubagentToolAllowlist> = {
  read: {
    piToolNames: ['read', 'grep', 'find', 'ls'],
    customToolNames: [],
  },
  write: {
    piToolNames: ['write', 'edit'],
    customToolNames: [],
  },
  execute: {
    piToolNames: ['bash'],
    customToolNames: ['process_start', 'process_list', 'process_logs', 'process_stop'],
  },
  network: {
    piToolNames: [],
    customToolNames: ['web_search', 'web_fetch'],
  },
  mcp: {
    piToolNames: [],
    customToolNames: [],
  },
  browser: {
    piToolNames: [],
    customToolNames: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type'],
  },
  planning: {
    piToolNames: [],
    customToolNames: ['piwin_plan_create', 'piwin_plan_set_step'],
  },
  delegate: {
    piToolNames: [],
    customToolNames: ['piwin_subagent_run'],
  },
};

/**
 * Resolve capabilities to a concrete tool allowlist. MCP tools are added by
 * the host bridge at session creation time when the `mcp` capability is
 * present; this function does not enumerate MCP tool names.
 */
export function resolveSubagentCapabilitiesToTools(
  capabilities: readonly SubagentCapability[] | undefined,
): SubagentToolAllowlist {
  if (!capabilities || capabilities.length === 0) {
    // No allowlist means default behavior (all tools); return empty to signal
    // "no restriction" to the caller. The caller preserves current behavior.
    return { piToolNames: [], customToolNames: [] };
  }
  const piToolNames = new Set<string>();
  const customToolNames = new Set<string>();
  for (const cap of capabilities) {
    const tools = CAPABILITY_TOOLS[cap];
    for (const name of tools.piToolNames) piToolNames.add(name);
    for (const name of tools.customToolNames) customToolNames.add(name);
  }
  return {
    piToolNames: [...piToolNames].sort(),
    customToolNames: [...customToolNames].sort(),
  };
}

/**
 * Returns true when the capability allowlist permits the given Pi built-in
 * tool name. When no allowlist is set, all tools are permitted.
 */
export function isPiToolAllowed(
  toolName: string,
  allowlist: SubagentToolAllowlist,
): boolean {
  if (allowlist.piToolNames.length === 0 && allowlist.customToolNames.length === 0) {
    return true;
  }
  return allowlist.piToolNames.includes(toolName);
}

/**
 * Returns true when the capability allowlist permits the given host custom
 * tool name. When no allowlist is set, all tools are permitted.
 */
export function isCustomToolAllowed(
  toolName: string,
  allowlist: SubagentToolAllowlist,
): boolean {
  if (allowlist.piToolNames.length === 0 && allowlist.customToolNames.length === 0) {
    return true;
  }
  return allowlist.customToolNames.includes(toolName);
}
