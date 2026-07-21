import { describe, expect, it } from 'vitest';
import { toPiCustomTool, toPiCustomTools } from './pi-tool-adapter.js';
import type { HostToolDefinition } from '@piwin/tools-web';

describe('toPiCustomTool', () => {
  it('maps host tool to Pi execute result shape', async () => {
    const hostTool: HostToolDefinition = {
      name: 'web_search',
      description: 'search',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
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
});
