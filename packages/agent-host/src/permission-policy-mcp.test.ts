import { describe, expect, it } from 'vitest';
import {
  evaluateMcpToolCallRisk,
  redactMcpArgumentsSummary,
  resolveNonInteractiveDecision,
} from './permission-policy.js';
import { buildPermissionRequestContext } from './permission-context.js';
import { assertMcpToolCallAllowed } from './mcp-call-permission.js';

describe('evaluateMcpToolCallRisk', () => {
  it('asks for every MCP tool unless it is explicitly trusted', () => {
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'list_items' }).decision).toBe(
      'ask',
    );
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'list_items' }).risk).toBe('read');
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'do_magic' }).decision).toBe('ask');
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'do_magic' }).risk).toBe('unknown');
  });

  it('asks for write/process/credential tools', () => {
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'delete_file' }).risk).toBe(
      'local-write',
    );
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'run_shell' }).risk).toBe('process');
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'auth_login' }).risk).toBe(
      'credential',
    );
  });

  it('redacts secret arguments', () => {
    const summary = redactMcpArgumentsSummary({
      token: 'super-secret',
      path: '/tmp/a',
    });
    expect(summary).toContain('[redacted]');
    expect(summary).not.toContain('super-secret');
    expect(summary).toContain('/tmp/a');
  });

  it('noninteractive ask denies', () => {
    const evaluation = evaluateMcpToolCallRisk({ serverId: 's', toolName: 'unknown_tool' });
    expect(resolveNonInteractiveDecision(evaluation)).toBe('deny');
  });
});

describe('assertMcpToolCallAllowed + context', () => {
  it('builds structured permission detail and context', async () => {
    let seenDetail = '';
    await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'write_page',
      arguments: { apiKey: 'abc', title: 'x' },
      requestPermission: async (request) => {
        seenDetail = request.detail;
        return 'allow';
      },
    });
    expect(seenDetail).toContain('docs/write_page');
    expect(seenDetail).toContain('risk=');
    expect(seenDetail).not.toContain('abc');

    const context = buildPermissionRequestContext('mcp:tool-call', seenDetail);
    expect(context.kind).toBe('mcp');
    expect(context.mcpTool?.serverId).toBe('docs');
    expect(context.mcpTool?.toolName).toBe('write_page');
    expect(context.mcpTool?.argumentsSummary).toContain('[redacted]');
  });

  it('denies without UI when risk is ask', async () => {
    await expect(
      assertMcpToolCallAllowed({
        serverId: 'docs',
        toolName: 'unknown_tool',
        arguments: {},
      }),
    ).rejects.toThrow(/Permission deny/);
  });
});
