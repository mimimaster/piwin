import { describe, expect, it } from 'vitest';
import {
  emptyMcpServerFormDraft,
  hasMcpServerEndpoint,
  mcpFormDraftToServer,
  mcpServerToFormDraft,
  validateMcpServerFormDraft,
} from './mcp-server-form-draft.js';

describe('MCP server form draft', () => {
  it('round-trips a stdio server, keeping env values as typed', () => {
    const server = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: { TOKEN: ' padded', API: '${API_KEY}' },
    };
    const draft = mcpServerToFormDraft('memory', server);
    expect(draft.transport).toBe('stdio');
    expect(mcpFormDraftToServer(draft)).toEqual(server);
  });

  it('round-trips a remote server and drops the space after header colons', () => {
    const draft = mcpServerToFormDraft('linear', {
      type: 'sse',
      url: 'https://mcp.linear.app/sse',
      headers: { Authorization: 'Bearer ${LINEAR}' },
    });
    expect(draft).toMatchObject({ transport: 'remote', remoteType: 'sse' });
    expect(draft.headersText).toBe('Authorization: Bearer ${LINEAR}');
    expect(mcpFormDraftToServer({ ...draft, headersText: 'X-Key:  abc\n# note\nbad' })).toEqual({
      type: 'sse',
      url: 'https://mcp.linear.app/sse',
      headers: { 'X-Key': 'abc' },
    });
  });

  it('omits type in auto mode so the Host can fall back to SSE', () => {
    const draft = {
      ...emptyMcpServerFormDraft(),
      id: 'r',
      transport: 'remote' as const,
      url: ' https://x.dev/mcp ',
    };
    expect(mcpFormDraftToServer(draft)).toEqual({ url: 'https://x.dev/mcp' });
  });

  it('keeps the other transport fields when switching back and forth', () => {
    const stdio = mcpServerToFormDraft('s', { command: 'node', args: ['server.js'] });
    const remote = { ...stdio, transport: 'remote' as const, url: 'https://x.dev/mcp' };
    expect(mcpFormDraftToServer({ ...remote, transport: 'stdio' })).toEqual({
      command: 'node',
      args: ['server.js'],
    });
  });

  it('validates the field the chosen transport needs', () => {
    const remote = {
      ...emptyMcpServerFormDraft(),
      id: 'r',
      transport: 'remote' as const,
      url: 'ftp://x',
    };
    expect(validateMcpServerFormDraft(remote, false)).toEqual({
      url: 'Enter an http:// or https:// URL.',
    });
    expect(hasMcpServerEndpoint(remote)).toBe(true);
    const stdio = { ...emptyMcpServerFormDraft(), id: 'bad id' };
    expect(validateMcpServerFormDraft(stdio, false)).toEqual({
      id: 'Only letters, digits, - and _ are allowed.',
      command: 'Command is required.',
    });
    expect(hasMcpServerEndpoint(stdio)).toBe(false);
  });
});
