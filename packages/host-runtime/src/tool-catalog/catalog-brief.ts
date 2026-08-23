/**
 * Model-facing catalog copy. MCP inventory still comes from the frozen
 * capability brief; this module only changes how that inventory is phrased
 * now that piwin_toolbox is the search/call shell.
 */

import { HOST_TOOLBOX_NAME } from '../host-toolbox.js';
import {
  MCP_BRIEF_MAX_DESCRIPTION_CHARS,
  MCP_BRIEF_MAX_SELECTOR_CHARS,
  MCP_BRIEF_MAX_SYSTEM_CHARS,
  type McpCapabilityBrief,
} from '../mcp-capability-brief.js';
import { MODEL_TOOL_DESCRIPTION_MAX_CHARS } from '../model-tool-descriptor.js';

export function formatCatalogSystemPrompt(brief: McpCapabilityBrief): string {
  if (brief.enabledServerCount === 0) {
    return [
      '## MCP tools',
      'No MCP servers are enabled in this session generation.',
      'If the user configures MCP later, a new generation rebuilds this surface.',
    ].join('\n');
  }

  const lines: string[] = [
    '## MCP tools (use them proactively)',
    `Use a pinned direct tool when it matches; otherwise use \`${HOST_TOOLBOX_NAME}\` proactively.`,
    'Catalog flow: `search(query)` → `call(target, arguments)`. Search results include exact schemas for top matches. `describe(target)` remains available. Never invent selectors. Search may lazily discover uncached servers.',
    'Configured servers:',
  ];

  if (brief.omittedServerCount > 0) {
    lines.push(
      `Configured server list truncated: ${brief.omittedServerCount} more configured server(s) omitted from this bounded list.`,
    );
  }

  for (const server of brief.servers) {
    if (server.cached) {
      const samples =
        server.sampleToolNames.length > 0 ? ` e.g. ${server.sampleToolNames.join(', ')}` : '';
      const more =
        server.toolCount > server.sampleToolNames.length
          ? ` (+${server.toolCount - server.sampleToolNames.length} more)`
          : '';
      lines.push(`- \`${server.serverId}\`: ${server.toolCount} cached tool(s)${samples}${more}`);
    } else {
      lines.push(
        `- \`${server.serverId}\`: metadata not cached yet — a normal search will try bounded lazy discovery; describe/call with a known selector also remain available`,
      );
    }
  }

  if (brief.directExposedNames.length > 0) {
    lines.push(`Pinned direct: ${brief.directExposedNames.slice(0, 16).join(', ')}`);
    if (brief.directExposedNames.length > 16) {
      lines.push(`- …(+${brief.directExposedNames.length - 16} more)`);
    }
  }

  return truncate(lines.join('\n'), MCP_BRIEF_MAX_SYSTEM_CHARS);
}

/**
 * Toolbox descriptor prose. Kept within the model-visible description budget
 * so compactModelToolDescriptor does not clip the Host target list.
 */
export function formatCatalogToolDescription(
  hostTargetNames: readonly string[],
  brief?: McpCapabilityBrief,
): string {
  const targets = hostTargetNames.length > 0 ? hostTargetNames.join(', ') : '(none)';
  const hasBrowserTargets = hostTargetNames.some((name) => name.startsWith('browser_'));
  const parts = hasBrowserTargets
    ? [
        'Right sidebar Browser: browser_*. First describe(target), then call(target, arguments); snapshot gives refs; find uses text.',
        `Host+MCP catalog. Host targets: ${targets}.`,
      ]
    : [
        `Host+MCP catalog. Host targets: ${targets}.`,
        'Known Host ids may describe/call; else search then call (top hits include schema).',
      ];

  if (brief && brief.enabledServerCount > 0) {
    const sampleSelectors = brief.servers
      .filter((server) => server.cached)
      .flatMap((server) =>
        server.sampleToolSelectors.filter(
          (selector) => selector.length <= Math.min(MCP_BRIEF_MAX_SELECTOR_CHARS, 96),
        ),
      )
      .slice(0, 2);
    if (sampleSelectors.length > 0) {
      parts.push(`e.g. ${sampleSelectors.join(', ')}.`);
    }
    const serverSummary = brief.servers
      .map((server) =>
        server.cached ? `${server.serverId}(${server.toolCount})` : `${server.serverId}(uncached)`,
      )
      .join(', ');
    parts.push(
      `MCP (${brief.enabledServerCount}): ${serverSummary || '(none)'}; ${brief.cachedToolCount} cached.`,
    );
    if (brief.directExposedNames.length > 0) {
      parts.push(`Pinned: ${brief.directExposedNames.slice(0, 4).join(', ')}.`);
    }
  } else if (brief && brief.enabledServerCount === 0) {
    parts.push('No MCP servers are enabled in this generation.');
  }

  return truncate(parts.join(' '), Math.min(MODEL_TOOL_DESCRIPTION_MAX_CHARS, MCP_BRIEF_MAX_DESCRIPTION_CHARS));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 1)}…`;
}
