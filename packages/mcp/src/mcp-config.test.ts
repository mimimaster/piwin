import { describe, expect, it } from 'vitest';
import { expandEnvMap, tryValidateMcpConfig, validateMcpConfig } from './mcp-config.js';
import { formatMcpExposedName, parseMcpExposedName } from './tool-names.js';
import { formatMcpCallResult } from './mcp-call-result.js';
import { fingerprintMcpServerConfig } from './mcp-fingerprint.js';

describe('validateMcpConfig', () => {
  it('accepts Cursor-compatible shape', () => {
    const document = validateMcpConfig({
      mcpServers: {
        memory: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-memory'],
          env: { FOO: 'bar' },
        },
      },
    });
    expect(document.mcpServers.memory?.command).toBe('npx');
    expect(document.mcpServers.memory).toMatchObject({
      args: ['-y', '@modelcontextprotocol/server-memory'],
    });
  });

  it('rejects missing command', () => {
    const result = tryValidateMcpConfig({
      mcpServers: {
        bad: { args: ['x'] },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('normalizes exact pinned selectors and rejects wildcard pins', () => {
    const document = validateMcpConfig({
      mcpServers: { github: { command: 'npx' } },
      pinnedSelectors: ['github.list_repos', 'github.list_repos'],
    });
    expect(document.pinnedSelectors).toEqual(['github.list_repos']);

    const invalid = tryValidateMcpConfig({
      mcpServers: { github: { command: 'npx' } },
      pinnedSelectors: ['github.*'],
    });
    expect(invalid.ok).toBe(false);
  });
});

describe('tool names', () => {
  it('round-trips exposed names', () => {
    const exposed = formatMcpExposedName('memory', 'store');
    expect(exposed).toBe('mcp__memory__store');
    expect(parseMcpExposedName(exposed)).toEqual({
      serverId: 'memory',
      toolName: 'store',
    });
  });

  it('formats MCP CallToolResult content as plain text', () => {
    expect(
      formatMcpCallResult({
        content: [{ type: 'text', text: '(项目: piwin) 找到 2 条记忆' }],
      }),
    ).toBe('(项目: piwin) 找到 2 条记忆');
    expect(formatMcpCallResult('already a string')).toBe('already a string');
    expect(formatMcpCallResult({ ok: true })).toContain('"ok"');
  });
});

describe('expandEnvMap', () => {
  it('expands ${VAR}', () => {
    const expanded = expandEnvMap({ TOKEN: 'pre-${API_KEY}-post' }, { API_KEY: 'secret' });
    expect(expanded.TOKEN).toBe('pre-secret-post');
  });
});

describe('remote MCP server config', () => {
  it('accepts a Cursor/Claude-style url server and normalizes streamable-http', () => {
    const document = validateMcpConfig({
      mcpServers: {
        linear: { url: ' https://mcp.linear.app/mcp ', headers: { Authorization: 'Bearer ${LINEAR}' } },
        legacy: { type: 'sse', url: 'http://localhost:3001/sse' },
        vscode: { type: 'streamable-http', url: 'https://example.com/mcp' },
      },
    });
    expect(document.mcpServers.linear).toEqual({
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: 'Bearer ${LINEAR}' },
    });
    expect(document.mcpServers.legacy).toEqual({ type: 'sse', url: 'http://localhost:3001/sse' });
    expect(document.mcpServers.vscode).toEqual({ type: 'http', url: 'https://example.com/mcp' });
  });

  it('rejects mixed, non-http, and misplaced transport fields', () => {
    const result = tryValidateMcpConfig({
      mcpServers: {
        both: { command: 'node', url: 'https://example.com/mcp' },
        ftp: { url: 'ftp://example.com/mcp' },
        argsOnRemote: { url: 'https://example.com/mcp', args: ['x'] },
        headersOnStdio: { command: 'node', headers: { A: 'b' } },
        badType: { url: 'https://example.com/mcp', type: 'websocket' },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual([
      'mcpServers.argsOnRemote.args',
      'mcpServers.badType.type',
      'mcpServers.both',
      'mcpServers.ftp.url',
      'mcpServers.headersOnStdio.headers',
    ]);
  });
});

describe('fingerprintMcpServerConfig', () => {
  it('keeps stdio fingerprints stable so cached tool metadata stays valid', () => {
    expect(
      fingerprintMcpServerConfig('memory', {
        command: 'npx',
        args: ['-y', 'x'],
        env: { B: '2', A: '1' },
        restartOnCrash: true,
      }),
    ).toBe('f8fd23573ff836fb4b10b26a');
  });

  it('changes a remote fingerprint when the url or a header changes', () => {
    const base = fingerprintMcpServerConfig('remote', { url: 'https://a.example/mcp' });
    expect(fingerprintMcpServerConfig('remote', { url: 'https://b.example/mcp' })).not.toBe(base);
    expect(
      fingerprintMcpServerConfig('remote', { url: 'https://a.example/mcp', headers: { X: '1' } }),
    ).not.toBe(base);
  });
});
