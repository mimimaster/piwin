import type {
  McpExposurePolicy,
  McpToolMetadata,
} from '@piwin/contracts';
import { createDefaultMcpExposurePolicy } from '@piwin/contracts';

/**
 * Deterministic hybrid exposure selection:
 * 1. valid cached tools only (caller supplies them)
 * 2. pinned selectors first
 * 3. then lexical serverId.toolName
 * 4. stop at count / serialized schema byte budget
 */
export function selectDirectMcpTools(
  tools: readonly McpToolMetadata[],
  policy: McpExposurePolicy = createDefaultMcpExposurePolicy(),
): {
  direct: McpToolMetadata[];
  gatewayOnly: McpToolMetadata[];
} {
  const pinned = new Set(policy.pinnedSelectors);
  const sorted = [...tools].sort((left, right) => {
    const leftPinned = pinned.has(left.selector) ? 0 : 1;
    const rightPinned = pinned.has(right.selector) ? 0 : 1;
    if (leftPinned !== rightPinned) {
      return leftPinned - rightPinned;
    }
    return left.selector.localeCompare(right.selector);
  });

  const direct: McpToolMetadata[] = [];
  const gatewayOnly: McpToolMetadata[] = [];
  let schemaBytes = 0;

  for (const tool of sorted) {
    const toolSchemaBytes = JSON.stringify(tool.inputSchema).length;
    const wouldExceedCount = direct.length >= policy.maxDirectTools;
    const wouldExceedBytes =
      schemaBytes + toolSchemaBytes > policy.maxDirectSchemaBytes;
    if (wouldExceedCount || wouldExceedBytes) {
      gatewayOnly.push(tool);
      continue;
    }
    direct.push(tool);
    schemaBytes += toolSchemaBytes;
  }

  return { direct, gatewayOnly };
}
