import { describe, expect, it } from 'vitest';
import { formatMcpCallResult, normalizeMcpToolResult } from './mcp-call-result.js';

describe('MCP result content', () => {
  it('preserves multiple images in order alongside joined text', () => {
    expect(normalizeMcpToolResult({ content: [
      { type: 'text', text: 'App state' },
      { type: 'image', mimeType: 'image/png', data: 'cG5n' },
      { type: 'text', text: 'After action' },
      { type: 'image', mimeType: 'image/jpeg', data: 'anBlZw==' },
    ] })).toEqual({
      output: 'App state\nAfter action',
      images: [
        { mimeType: 'image/png', dataBase64: 'cG5n' },
        { mimeType: 'image/jpeg', dataBase64: 'anBlZw==' },
      ],
    });
  });

  it('keeps image-only base64 out of text', () => {
    const result = { content: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }] };
    expect(formatMcpCallResult(result)).toBe('MCP returned image content.');
    expect(normalizeMcpToolResult(result).images).toHaveLength(1);
  });

  it('ignores malformed image blocks without serializing their data', () => {
    expect(normalizeMcpToolResult({ content: [
      null,
      { type: 'image', mimeType: 'text/plain', data: 'cG5n' },
      { type: 'image', mimeType: 'image/png', data: '' },
      { type: 'image', mimeType: 'image/png', data: 'data:image/png;base64,cG5n' },
      { type: 'image', mimeType: 'image/png', data: 42 },
      { type: 'image', data: 'cG5n' },
    ] })).toEqual({ output: 'MCP returned image content.' });
  });

  it('preserves text, primitive, and structured-result fallbacks', () => {
    expect(normalizeMcpToolResult('pong')).toEqual({ output: 'pong' });
    expect(normalizeMcpToolResult(null)).toEqual({ output: '' });
    expect(normalizeMcpToolResult(42)).toEqual({ output: '42' });
    expect(normalizeMcpToolResult({ structuredContent: { count: 2 } })).toEqual({
      output: JSON.stringify({ structuredContent: { count: 2 } }, null, 2),
    });
  });
});
