import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, SessionToolFamily } from '@piwin/contracts';
import { buildHostToolboxRegistration, HOST_TOOLBOX_NAME } from './host-toolbox.js';
import { descriptorsFromTools } from './tools/build-session-host-tools.js';

function tool(name: string, family: SessionToolFamily): HostToolRegistration {
  return {
    descriptor: {
      name,
      description: `${name} exact description`,
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
    },
    family,
    permissionSpec: {
      action: `test:${name}`,
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute() {
      return { ok: true, output: name };
    },
  };
}

describe('Host toolbox model projection', () => {
  it('keeps high-frequency and pinned MCP tools direct while hiding low-frequency schemas', () => {
    const direct = tool('mcp__fast_context__fast_context_search', 'mcp');
    const process = tool('process_start', 'process');
    const browser = tool('browser_snapshot', 'browser');
    const toolbox = buildHostToolboxRegistration([direct, process, browser]);

    const descriptors = descriptorsFromTools([direct, process, browser, toolbox]);
    const names = descriptors.map((descriptor) => descriptor.name);

    expect(names).toEqual(['mcp__fast_context__fast_context_search', HOST_TOOLBOX_NAME]);
    expect(toolbox.descriptor.description).toContain('process_start');
    expect(toolbox.descriptor.description).toContain('browser_snapshot');
    expect(toolbox.descriptor.description).not.toContain('fast_context_search');
  });
});
