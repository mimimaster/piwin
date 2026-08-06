import { describe, expect, it } from 'vitest';
import type { McpToolMetadata } from '@piwin/contracts';
import { selectDirectMcpTools } from './mcp-exposure-policy.js';

function tool(
  selector: string,
  schemaBytes: number,
): McpToolMetadata {
  const [serverId, toolName] = selector.split('.') as [string, string];
  return {
    serverId,
    toolName,
    selector,
    description: selector,
    inputSchema: { pad: 'x'.repeat(Math.max(0, schemaBytes - 20)) },
    metadataFingerprint: 'fp',
    fetchedAt: '2026-07-24T00:00:00.000Z',
  };
}

describe('selectDirectMcpTools', () => {
  it('prefers pinned selectors and respects count budget', () => {
    const tools = [
      tool('a.one', 10),
      tool('b.two', 10),
      tool('c.three', 10),
    ];
    const result = selectDirectMcpTools(tools, {
      mode: 'pinned',
      maxDirectTools: 2,
      maxDirectSchemaBytes: 100_000,
      pinnedSelectors: ['c.three'],
    });
    expect(result.direct.map((item) => item.selector)).toEqual([
      'c.three',
    ]);
    expect(result.gatewayOnly.map((item) => item.selector)).toEqual(['a.one', 'b.two']);
  });

  it('respects schema byte budget', () => {
    const tools = [tool('a.big', 80), tool('b.small', 10)];
    const result = selectDirectMcpTools(tools, {
      mode: 'pinned',
      maxDirectTools: 10,
      maxDirectSchemaBytes: 50,
      pinnedSelectors: ['b.small', 'a.big'],
    });
    expect(result.direct.map((item) => item.selector)).toEqual(['b.small']);
    expect(result.gatewayOnly.map((item) => item.selector)).toEqual(['a.big']);
    expect(result.overflow.map((item) => item.selector)).toEqual(['a.big']);
  });

  it('keeps every tool behind the gateway in gateway mode', () => {
    const result = selectDirectMcpTools([tool('a.one', 10)], {
      mode: 'gateway',
      maxDirectTools: 10,
      maxDirectSchemaBytes: 10_000,
      pinnedSelectors: [],
    });
    expect(result.direct).toEqual([]);
    expect(result.gatewayOnly.map((item) => item.selector)).toEqual(['a.one']);
  });
});
