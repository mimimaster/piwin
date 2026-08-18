/** Model-visible piwin_toolbox v2: searchable catalog shell. */

import type { HostToolDescriptor, HostToolRegistration, ToolResult } from '@piwin/contracts';
import { HOST_TOOLBOX_NAME, isHostToolboxTargetFamily } from '../host-toolbox.js';
import { MODEL_TOOL_DESCRIPTION_MAX_CHARS } from '../model-tool-descriptor.js';
import type { McpCapabilityBrief } from '../mcp-capability-brief.js';
import { formatCatalogToolDescription } from './catalog-brief.js';
import type { ToolCatalogService } from './catalog-service.js';

const catalogs = new WeakMap<HostToolRegistration, ToolCatalogService>();

export function getAttachedToolCatalog(
  registration: HostToolRegistration,
): ToolCatalogService | undefined {
  return catalogs.get(registration);
}

export function buildHostToolboxRegistration(
  targets: readonly HostToolRegistration[],
  options: {
    catalog?: ToolCatalogService;
    mcpBrief?: McpCapabilityBrief;
  } = {},
): HostToolRegistration {
  const targetNames = targets
    .filter((tool) => isHostToolboxTargetFamily(tool.family))
    .map((tool) => tool.descriptor.name)
    .sort();
  const registration: HostToolRegistration = {
    descriptor: buildHostToolboxDescriptor(targetNames, options.mcpBrief),
    family: 'toolbox',
    permissionSpec: {
      action: 'toolbox:route',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute(): Promise<ToolResult> {
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'piwin_toolbox requires the session Host tool execution port',
      };
    },
  };
  if (options.catalog) {
    catalogs.set(registration, options.catalog);
  }
  return registration;
}

export function buildHostToolboxDescriptor(
  targetNames: readonly string[],
  mcpBrief?: McpCapabilityBrief,
): HostToolDescriptor {
  const exactTargetNames = [...new Set(targetNames)].sort();
  return {
    name: HOST_TOOLBOX_NAME,
    description: formatCatalogToolDescription(exactTargetNames, mcpBrief),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'describe', 'call', 'status'] },
        query: { type: 'string' },
        target: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true },
        limit: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  };
}

export const CATALOG_TOOLBOX_DESCRIPTION_BUDGET = MODEL_TOOL_DESCRIPTION_MAX_CHARS;
