import { describe, expect, it } from 'vitest';
import { expandEnvMap, tryValidateMcpConfig, validateMcpConfig } from './mcp-config.js';
import { formatMcpCallResult, formatMcpExposedName, parseMcpExposedName } from './tool-names.js';

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
    expect(document.mcpServers.memory?.args).toEqual(['-y', '@modelcontextprotocol/server-memory']);
  });

  it('rejects missing command', () => {
    const result = tryValidateMcpConfig({
      mcpServers: {
        bad: { args: ['x'] },
      },
    });
    expect(result.ok).toBe(false);
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
