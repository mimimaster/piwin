/**
 * Worker-side proxy tool factory (Phase 7 plan §7.1, WP4).
 *
 * Registers Pi custom tools whose executors call back to the parent Host
 * over JSONL `tool-call` / `tool-result` frames. The worker never imports
 * tool executors (web, MCP, process, browser, notes, etc.) — it only
 * declares the tool name + parameter schema and proxies execution.
 *
 * Parameter schemas and descriptions are copied from the exact descriptors
 * in the compiled blueprint, so dynamic MCP schemas remain unchanged.
 */

import type { HostToolDescriptor, ToolResult } from '@piwin/contracts';
import {
  PiBackendToolExecutionError,
  type PiBackendCustomToolDefinition,
} from '../backends/pi-backend-tool-adapter.js';
import type { SerializableBlueprint } from './serializable-blueprint.js';

/**
 * Callback that sends a tool-call to the parent and returns the result.
 * The worker runtime implements this by emitting a `tool-call` frame and
 * awaiting the matching `tool-result` frame by correlation id.
 */
export type ToolProxyCall = (
  sessionId: string,
  backendToolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ToolResult>;

/**
 * Build proxy tool definitions for every descriptor in the blueprint's
 * `hostTools`. Returns an empty array when the allowlist is empty
 * (Phase 7 plan P7-08: empty allowlist means no tools, not unrestricted).
 */
export function buildWorkerProxyTools(
  blueprint: SerializableBlueprint,
  proxyCall: ToolProxyCall,
  productSessionId: string,
): PiBackendCustomToolDefinition[] {
  const tools: PiBackendCustomToolDefinition[] = [];
  for (const descriptor of blueprint.tools.hostTools) {
    tools.push(buildSingleProxyTool(descriptor, proxyCall, productSessionId));
  }
  return tools;
}

/**
 * Build a single proxy tool definition. Exported for testing.
 */
export function buildSingleProxyTool(
  descriptor: HostToolDescriptor,
  proxyCall: ToolProxyCall,
  productSessionId: string,
): PiBackendCustomToolDefinition {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description,
    // The parent compiled this schema. Do not infer or widen it in the worker.
    parameters: descriptor.parameters,
    async execute(toolCallId, params, signal) {
      const result = await proxyCall(
        productSessionId,
        toolCallId,
        descriptor.name,
        params ?? {},
        signal,
      );
      if (result.ok) {
        return {
          content: [{ type: 'text', text: result.output }],
          details: {
            toolName: descriptor.name,
            toolCallId,
            proxied: true,
            ...(result.details ?? {}),
          },
        };
      }
      // Map parent error codes to model-facing text.
      throw new PiBackendToolExecutionError(result.code, result.message);
    },
  };
}
