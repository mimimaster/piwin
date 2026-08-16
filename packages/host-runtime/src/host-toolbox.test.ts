import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, SessionToolFamily } from '@piwin/contracts';
import { buildHostToolboxDescriptor, buildHostToolboxRegistration, HOST_TOOLBOX_NAME } from './host-toolbox.js';
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

describe('buildHostToolboxDescriptor (CHT-204)', () => {
  function targetEnum(targetNames: readonly string[]): string[] {
    const descriptor = buildHostToolboxDescriptor(targetNames);
    const properties = descriptor.parameters.properties as Record<string, { enum?: string[] }>;
    return (properties.target?.enum ?? []) as string[];
  }

  it('dedupes and sorts the target enum', () => {
    expect(targetEnum(['image_gen', 'flashcard_create', 'image_gen', 'browser_navigate'])).toEqual(
      ['browser_navigate', 'flashcard_create', 'image_gen'],
    );
  });

  it('describes only the capabilities actually offered', () => {
    const descriptor = buildHostToolboxDescriptor(['flashcard_create', 'image_gen']);
    expect(descriptor.name).toBe(HOST_TOOLBOX_NAME);
    expect(descriptor.description).toContain('Available targets: flashcard_create, image_gen');
    expect(descriptor.description).not.toContain('browser');
    expect(descriptor.description).not.toContain('process');
    expect(descriptor.description).not.toContain('notes');
    expect(descriptor.description).not.toContain('Use proactively');
  });

  it('handles an empty target set stably', () => {
    const descriptor = buildHostToolboxDescriptor([]);
    expect(targetEnum([])).toEqual([]);
    expect(descriptor.description).toContain('Available targets: ');
  });

  it('keeps the describe/call lazy action surface', () => {
    const descriptor = buildHostToolboxDescriptor(['image_gen']);
    const properties = descriptor.parameters.properties as Record<
      string,
      { enum?: string[]; type?: string }
    >;
    expect(properties.action?.enum).toEqual(['describe', 'call']);
    expect(descriptor.parameters.required).toContain('action');
    expect(descriptor.parameters.required).toContain('target');
  });
});
