/**
 * Worker-side proxy tool factory (Phase 7 plan §7.1, WP4).
 *
 * Registers Pi custom tools whose executors call back to the parent Host
 * over JSONL `tool-call` / `tool-result` frames. The worker never imports
 * tool executors (web, MCP, process, browser, notes, etc.) — it only
 * declares the tool name + parameter schema and proxies execution.
 *
 * Parameter schemas are generated from the tool name using the same pure
 * `parametersForHostTool` function the SDK path uses, so the model sees
 * identical tool definitions in both modes.
 */

import Type from 'typebox';
import type { HostToolDefinition } from '@piwin/tools-web';
import type { PiCustomToolDefinition } from '../pi-tool-adapter.js';
import { parametersForHostTool } from '../pi-tool-adapter.js';
import type { SerializableBlueprint } from './serializable-blueprint.js';

/**
 * Callback that sends a tool-call to the parent and returns the result.
 * The worker runtime implements this by emitting a `tool-call` frame and
 * awaiting the matching `tool-result` frame by correlation id.
 */
export type ToolProxyCall = (
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{ ok: true; output: string } | { ok: false; code: string; message: string }>;

/**
 * Build proxy tool definitions for every name in the blueprint's
 * `customToolNames`. Returns an empty array when the allowlist is empty
 * (Phase 7 plan P7-08: empty allowlist means no tools, not unrestricted).
 */
export function buildWorkerProxyTools(
  blueprint: SerializableBlueprint,
  proxyCall: ToolProxyCall,
): PiCustomToolDefinition[] {
  const tools: PiCustomToolDefinition[] = [];
  for (const toolName of blueprint.tools.customToolNames) {
    tools.push(buildSingleProxyTool(toolName, proxyCall));
  }
  return tools;
}

/**
 * Build a single proxy tool definition. Exported for testing.
 */
export function buildSingleProxyTool(
  toolName: string,
  proxyCall: ToolProxyCall,
): PiCustomToolDefinition {
  const parameters = parametersForProxyTool(toolName);
  return {
    name: toolName,
    label: toolName,
    description: `Proxied host tool: ${toolName}`,
    parameters,
    async execute(toolCallId, params, signal) {
      const sessionId = extractSessionIdFromToolCallId(toolCallId);
      const result = await proxyCall(sessionId, toolName, params ?? {}, signal);
      if (result.ok) {
        return {
          content: [{ type: 'text', text: result.output }],
          details: { toolName, toolCallId, proxied: true },
        };
      }
      // Map parent error codes to model-facing text.
      const errorText = formatProxyError(result.code, result.message);
      return {
        content: [{ type: 'text', text: errorText }],
        details: { toolName, toolCallId, proxied: true, error: result.code },
      };
    },
  };
}

/**
 * Generate the parameter schema for a proxy tool. Uses the same pure
 * `parametersForHostTool` function as the SDK path so the model sees
 * identical schemas. Falls back to free-form for unknown tool names.
 */
function parametersForProxyTool(toolName: string): unknown {
  // Build a minimal HostToolDefinition so the pure schema function can
  // generate the same typebox schema the SDK path uses. For mcp__ prefixed
  // tools, parametersForHostTool reads tool.parameters (Unsafe).
  const fakeTool: HostToolDefinition = {
    name: toolName,
    description: '',
    parameters: {},
    execute: async () => '',
  };
  return parametersForHostTool(fakeTool);
}

/**
 * Extract the product session id from a Pi tool call id. The worker runtime
 * prefixes tool call ids with the session id when proxying (see
 * WorkerSessionRuntime). If the prefix is absent, return empty string and
 * the parent will reject with session-not-found.
 */
function extractSessionIdFromToolCallId(toolCallId: string): string {
  const sep = toolCallId.indexOf('|');
  return sep > 0 ? toolCallId.slice(0, sep) : '';
}

function formatProxyError(code: string, message: string): string {
  switch (code) {
    case 'tool-not-available':
      return `Tool not available: ${message}`;
    case 'tool-disabled':
      return `Tool disabled: ${message}`;
    case 'permission-denied':
      return `Permission denied: ${message}`;
    case 'aborted':
      return `Tool execution aborted`;
    default:
      return `Tool error (${code}): ${message}`;
  }
}
