import { describe, expect, it } from 'vitest';
import { toPiCustomTool, toPiCustomTools } from './pi-tool-adapter.js';
import type { HostToolDefinition } from '@piwin/tools-web';

describe('toPiCustomTool', () => {
  it('maps host tool to Pi execute result shape', async () => {
    const hostTool: HostToolDefinition = {
      name: 'web_search',
      description: 'search',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      async execute(args) {
        return JSON.stringify({ query: args.query, hits: [] });
      },
    };
    const piTool = toPiCustomTool(hostTool);
    expect(piTool.name).toBe('web_search');
    expect(piTool.label).toBe('web_search');
    expect(piTool.parameters).toBeTruthy();
    const result = await piTool.execute(
      'call-1',
      { query: 'hello' },
      undefined,
      undefined,
      undefined,
    );
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('hello');
    expect(result.details.toolCallId).toBe('call-1');
  });

  it('converts multiple tools', () => {
    const tools = toPiCustomTools([
      {
        name: 'web_fetch',
        description: 'fetch',
        parameters: {},
        async execute() {
          return '{}';
        },
      },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('web_fetch');
  });

  it('preserves a direct MCP JSON schema for Pi', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    };
    const piTool = toPiCustomTool({
      name: 'mcp__docs__search',
      description: 'Search docs',
      parameters: schema,
      async execute() {
        return '{}';
      },
    });

    expect(piTool.parameters).toMatchObject(schema);
  });

  it('maps image_gen parameters to a TypeBox object schema', () => {
    const piTool = toPiCustomTool({
      name: 'image_gen',
      description: 'generate image',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed prompt' },
          model: { type: 'string', description: 'Optional model id' },
        },
        required: ['prompt'],
      },
      async execute() {
        return '{}';
      },
    });
    expect(piTool.name).toBe('image_gen');
    expect(piTool.parameters).toBeTruthy();
    // The TypeBox schema should have prompt as a required string property
    const params = piTool.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(params.properties?.prompt).toBeTruthy();
    expect(params.required).toContain('prompt');
  });
});
