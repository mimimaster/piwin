/** Compile the exact model-visible ToolManifest (spec §9.3, §9.6). */

import type { SubagentCapability, ToolManifest } from '@piwin/contracts';

export type CandidateToolSet = {
  customToolNames: string[];
  piBuiltinToolNames: string[];
  /** MCP server ids that produced live tools. */
  enabledMcpServerIds: string[];
};

/** Policy-enforced enabled tool names, plus optional immutable subagent ceiling. */
export type ToolManifestInput = {
  candidate: CandidateToolSet;
  policy: {
    customToolNames: string[];
    piBuiltinToolNames: string[];
    enabledMcpServerIds: string[];
  };
  /**
   * Subagent ceiling intersected at child creation. When present, only tools
   * derived from these capabilities are allowed; the intersection is exact so
   * a new globally added tool never expands an existing child ceiling.
   */
  subagentCapabilities?: SubagentCapability[];
};

/** Maps product capability ids to the exact custom tool names they permit. */
const CAPABILITY_CUSTOM_TOOLS: Readonly<Record<SubagentCapability, readonly string[]>> = {
  read: [],
  write: [],
  execute: ['process_start', 'process_list', 'process_logs', 'process_stop'],
  network: ['web_search', 'web_fetch'],
  mcp: [],
  browser: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type'],
  planning: ['piwin_plan_create', 'piwin_plan_set_step'],
  delegate: ['piwin_subagent_run'],
};

/** Maps product capability ids to the exact Pi built-in tool names they permit. */
const CAPABILITY_PI_BUILTIN_TOOLS: Readonly<Record<SubagentCapability, readonly string[]>> = {
  read: ['read', 'grep', 'find', 'ls'],
  write: ['write', 'edit'],
  execute: ['bash'],
  network: [],
  mcp: [],
  browser: [],
  planning: [],
  delegate: [],
};

function intersectWithCeiling(allowed: readonly string[], ceiling: ReadonlySet<string>): string[] {
  return allowed.filter((name) => ceiling.has(name)).sort();
}

/**
 * Build the exact ToolManifest for one session/child. An empty capability
 * array means NO tools are allowed (spec §9.6); omitting the ceiling means
 * the global session policy applies unchanged.
 */
export function buildToolManifest(input: ToolManifestInput): ToolManifest {
  const policySet = new Set(input.policy.customToolNames);
  const piPolicySet = new Set(input.policy.piBuiltinToolNames);

  // Global session (no ceiling): policy defines the exact set.
  if (input.subagentCapabilities === undefined) {
    return {
      customToolNames: intersectWithCeiling(input.candidate.customToolNames, policySet),
      piBuiltinToolNames: intersectWithCeiling(input.candidate.piBuiltinToolNames, piPolicySet),
      enabledMcpServerIds: input.policy.enabledMcpServerIds,
      enabledFamilies: [],
    };
  }

  // Subagent ceiling: intersect global policy with capability-derived names.
  const ceilingCustom = new Set<string>();
  const ceilingPi = new Set<string>();
  for (const capability of input.subagentCapabilities) {
    for (const name of CAPABILITY_CUSTOM_TOOLS[capability]) ceilingCustom.add(name);
    for (const name of CAPABILITY_PI_BUILTIN_TOOLS[capability]) ceilingPi.add(name);
  }

  const custom = input.candidate.customToolNames.filter(
    (name) => policySet.has(name) && ceilingCustom.has(name),
  );
  const piBuiltin = input.candidate.piBuiltinToolNames.filter(
    (name) => piPolicySet.has(name) && ceilingPi.has(name),
  );

  return {
    customToolNames: custom.sort(),
    piBuiltinToolNames: piBuiltin.sort(),
    enabledMcpServerIds: input.policy.enabledMcpServerIds,
    enabledFamilies: [],
  };
}
