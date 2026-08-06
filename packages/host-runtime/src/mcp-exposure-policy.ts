import type {
  McpExposurePolicy,
  McpToolMetadata,
} from '@piwin/contracts';
import { createDefaultMcpExposurePolicy } from '@piwin/contracts';

/**
 * Deterministic gateway-first exposure selection:
 * 1. valid cached tools only (caller supplies them)
 * 2. gateway mode exposes no direct tools
 * 3. pinned mode considers exact pinned selectors only
 * 4. stop at count / serialized schema byte budget
 */
export function selectDirectMcpTools(
  tools: readonly McpToolMetadata[],
  policy: McpExposurePolicy = createDefaultMcpExposurePolicy(),
): {
  direct: McpToolMetadata[];
  gatewayOnly: McpToolMetadata[];
  overflow: McpToolMetadata[];
} {
  const pinned = new Set(policy.pinnedSelectors);
  const sorted = [...tools].sort((left, right) => {
    const leftOrder = policy.pinnedSelectors.indexOf(left.selector);
    const rightOrder = policy.pinnedSelectors.indexOf(right.selector);
    if (leftOrder >= 0 || rightOrder >= 0) {
      if (leftOrder < 0) {
        return 1;
      }
      if (rightOrder < 0) {
        return -1;
      }
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }
    return left.selector.localeCompare(right.selector);
  });

  const direct: McpToolMetadata[] = [];
  const gatewayOnly: McpToolMetadata[] = [];
  const overflow: McpToolMetadata[] = [];
  let schemaBytes = 0;

  for (const tool of sorted) {
    if (policy.mode !== 'pinned' || !pinned.has(tool.selector)) {
      gatewayOnly.push(tool);
      continue;
    }
    const toolSchemaBytes = JSON.stringify(tool.inputSchema).length;
    const wouldExceedCount = direct.length >= policy.maxDirectTools;
    const wouldExceedBytes =
      schemaBytes + toolSchemaBytes > policy.maxDirectSchemaBytes;
    if (wouldExceedCount || wouldExceedBytes) {
      gatewayOnly.push(tool);
      overflow.push(tool);
      continue;
    }
    direct.push(tool);
    schemaBytes += toolSchemaBytes;
  }

  return { direct, gatewayOnly, overflow };
}
