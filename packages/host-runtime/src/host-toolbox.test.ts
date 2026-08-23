import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, SessionToolFamily } from '@piwin/contracts';
import { HOST_TOOLBOX_NAME } from './host-toolbox.js';
import {
  buildHostToolboxDescriptor,
  buildHostToolboxRegistration,
} from './tool-catalog/catalog-tool.js';
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

    expect(names).toEqual([
      'mcp__fast_context__fast_context_search',
      'browser_snapshot',
      HOST_TOOLBOX_NAME,
    ]);
    expect(toolbox.descriptor.description).toContain('process_start');
    expect(toolbox.descriptor.description).not.toContain('browser_snapshot');
    expect(toolbox.descriptor.description).not.toContain('fast_context_search');
  });
});

describe('buildHostToolboxDescriptor (catalog v2)', () => {
  it('describes only the Host capabilities actually offered', () => {
    const descriptor = buildHostToolboxDescriptor(['flashcard_create', 'image_gen']);
    expect(descriptor.name).toBe(HOST_TOOLBOX_NAME);
    expect(descriptor.description).toContain('Host targets: flashcard_create, image_gen');
    expect(descriptor.description).not.toContain('browser');
    expect(descriptor.description).not.toContain('process');
    expect(descriptor.description).not.toContain('notes');
  });

  it('handles an empty target set stably', () => {
    const descriptor = buildHostToolboxDescriptor([]);
    expect(descriptor.description).toContain('Host targets: (none)');
  });

  it('exposes search/describe/call/status with a string target', () => {
    const descriptor = buildHostToolboxDescriptor(['image_gen']);
    const properties = descriptor.parameters.properties as Record<
      string,
      { enum?: string[]; type?: string }
    >;
    expect(properties.action?.enum).toEqual(['search', 'describe', 'call', 'status']);
    expect(properties.target?.type).toBe('string');
    expect(properties.target?.enum).toBeUndefined();
    expect(descriptor.parameters.required).toEqual(['action']);
  });
});
