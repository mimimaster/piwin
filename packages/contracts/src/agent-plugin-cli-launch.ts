/**
 * Pure decoder for `session/cli-launch` results.
 *
 * The descriptor names only the trusted native session id and argv tokens the
 * Host may attach to an already-verified binary under a trusted cwd. It never
 * carries executable, cwd, or env overrides, and validation never spawns.
 */

export type AgentPluginCliLaunchResult = {
  backendSessionId: string;
  args: readonly string[];
};

export const AGENT_PLUGIN_CLI_LAUNCH_MAX_BACKEND_SESSION_ID_CHARS = 256;
export const AGENT_PLUGIN_CLI_LAUNCH_MAX_ARG_CHARS = 4096;
export const AGENT_PLUGIN_CLI_LAUNCH_MAX_ARGS = 64;
export const AGENT_PLUGIN_CLI_LAUNCH_MAX_ARGS_TOTAL_CHARS = 32 * 1024;

const RESULT_KEYS = ['backendSessionId', 'args'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Native id / argv tokens: nonempty, bounded, no control framing characters. */
export function isAgentPluginCliArgToken(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxChars &&
    !/[\0\r\n]/.test(value);
}

/**
 * Decode a launch descriptor. When `expectedBackendSessionId` is set, the
 * reported id must match that trusted persisted native id exactly.
 */
export function parseAgentPluginCliLaunchResult(
  value: unknown,
  expectedBackendSessionId?: string,
): AgentPluginCliLaunchResult | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS)) {
    return undefined;
  }
  if (!isAgentPluginCliArgToken(value.backendSessionId, AGENT_PLUGIN_CLI_LAUNCH_MAX_BACKEND_SESSION_ID_CHARS)) {
    return undefined;
  }
  if (expectedBackendSessionId !== undefined && value.backendSessionId !== expectedBackendSessionId) {
    return undefined;
  }
  if (!Array.isArray(value.args) || value.args.length === 0 || value.args.length > AGENT_PLUGIN_CLI_LAUNCH_MAX_ARGS) {
    return undefined;
  }

  const args: string[] = [];
  let totalChars = 0;
  let containsNativeId = false;
  for (const entry of value.args) {
    if (!isAgentPluginCliArgToken(entry, AGENT_PLUGIN_CLI_LAUNCH_MAX_ARG_CHARS)) {
      return undefined;
    }
    totalChars += entry.length;
    if (totalChars > AGENT_PLUGIN_CLI_LAUNCH_MAX_ARGS_TOTAL_CHARS) {
      return undefined;
    }
    if (entry === value.backendSessionId) {
      containsNativeId = true;
    }
    args.push(entry);
  }
  if (!containsNativeId) {
    return undefined;
  }
  return { backendSessionId: value.backendSessionId, args };
}

export function isAgentPluginCliLaunchResult(
  value: unknown,
  expectedBackendSessionId?: string,
): value is AgentPluginCliLaunchResult {
  return parseAgentPluginCliLaunchResult(value, expectedBackendSessionId) !== undefined;
}
