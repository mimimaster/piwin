import { describe, expect, it } from 'vitest';
import type { PermissionRuleSet } from '@piwin/contracts';
import { createEmptyRuleSet } from '@piwin/contracts';
import {
  evaluateMcpToolCallRisk,
  redactMcpArgumentsSummary,
  resolveNonInteractiveDecision,
} from './permission-policy.js';
import { buildPermissionRequestContext } from './permission-context.js';
import { assertMcpToolCallAllowed } from './mcp-call-permission.js';

describe('evaluateMcpToolCallRisk', () => {
  it('classifies risk for display (decision is display-only, not the gate)', () => {
    expect(evaluateMcpToolCallRisk({ serverId: 's', toolName: 'list_items' }).risk).toBe('read');
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

describe('assertMcpToolCallAllowed (ADR 0019 §5 — enabled server = trusted)', () => {
  it('allows without prompting when no rules are configured', async () => {
    let permissionCalls = 0;
    const target = await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'write_page',
      arguments: { apiKey: 'abc', title: 'x' },
      requestPermission: async () => {
        permissionCalls += 1;
        return 'allow';
      },
    });
    expect(permissionCalls).toBe(0);
    expect(target.selector).toBe('docs.write_page');
    expect(target.risk).toBe('local-write');
    // Risk classification + redaction still run for UI display.
    expect(target.argumentsSummary).toContain('[redacted]');
    expect(target.argumentsSummary).not.toContain('abc');
  });

  it('allows without prompting when rules have no MCP match', async () => {
    let permissionCalls = 0;
    const rules: PermissionRuleSet = {
      deny: [
        { target: { kind: 'bash', pattern: 'rm -rf /' }, decision: 'deny', reason: 'rm-root' },
      ],
      ask: [],
      allow: [],
    };
    const target = await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'write_page',
      arguments: {},
      rules,
      requestPermission: async () => {
        permissionCalls += 1;
        return 'allow';
      },
    });
    expect(permissionCalls).toBe(0);
    expect(target.selector).toBe('docs.write_page');
  });

  it('blocks on explicit deny rule', async () => {
    const rules: PermissionRuleSet = {
      deny: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.*' },
          decision: 'deny',
          reason: 'docs-blocked',
        },
      ],
      ask: [],
      allow: [],
    };
    await expect(
      assertMcpToolCallAllowed({
        serverId: 'docs',
        toolName: 'write_page',
        arguments: {},
        rules,
        requestPermission: async () => 'allow',
      }),
    ).rejects.toThrow(/Permission deny for MCP tool docs\.write_page/);
  });

  it('prompts on explicit ask rule when requestPermission is provided', async () => {
    const seenDetails: string[] = [];
    const rules: PermissionRuleSet = {
      deny: [],
      ask: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.write_page' },
          decision: 'ask',
          reason: 'docs-write-review',
        },
      ],
      allow: [],
    };
    const target = await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'write_page',
      arguments: { apiKey: 'abc', title: 'x' },
      rules,
      requestPermission: async (request) => {
        seenDetails.push(request.detail);
        return 'allow';
      },
    });
    expect(target.selector).toBe('docs.write_page');
    expect(seenDetails).toHaveLength(1);
    expect(seenDetails[0]).toContain('docs/write_page');
    expect(seenDetails[0]).toContain('risk=');
    expect(seenDetails[0]).not.toContain('abc');
  });

  it('non-interactive deny on explicit ask rule without requestPermission', async () => {
    const rules: PermissionRuleSet = {
      deny: [],
      ask: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.*' },
          decision: 'ask',
          reason: 'docs-review',
        },
      ],
      allow: [],
    };
    await expect(
      assertMcpToolCallAllowed({
        serverId: 'docs',
        toolName: 'write_page',
        arguments: {},
        rules,
      }),
    ).rejects.toThrow(/Permission deny for MCP tool docs\.write_page/);
  });

  it('explicit allow rule permits without prompt', async () => {
    let permissionCalls = 0;
    const rules: PermissionRuleSet = {
      deny: [],
      ask: [],
      allow: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.*' },
          decision: 'allow',
          reason: 'docs-trusted',
        },
      ],
    };
    const target = await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'write_page',
      arguments: {},
      rules,
      requestPermission: async () => {
        permissionCalls += 1;
        return 'allow';
      },
    });
    expect(permissionCalls).toBe(0);
    expect(target.selector).toBe('docs.write_page');
  });

  it('deny tier wins over ask tier for the same selector', async () => {
    const rules: PermissionRuleSet = {
      deny: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.*' },
          decision: 'deny',
          reason: 'docs-blocked',
        },
      ],
      ask: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.write_page' },
          decision: 'ask',
          reason: 'docs-review',
        },
      ],
      allow: [],
    };
    await expect(
      assertMcpToolCallAllowed({
        serverId: 'docs',
        toolName: 'write_page',
        arguments: {},
        rules,
        requestPermission: async () => 'allow',
      }),
    ).rejects.toThrow(/Permission deny/);
  });

  it('builds structured permission context from ask-rule prompt detail', async () => {
    const rules: PermissionRuleSet = {
      deny: [],
      ask: [
        {
          target: { kind: 'mcp', selectorGlob: 'docs.write_page' },
          decision: 'ask',
          reason: 'docs-review',
        },
      ],
      allow: [],
    };
    let seenDetail = '';
    await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'write_page',
      arguments: { apiKey: 'abc', title: 'x' },
      rules,
      requestPermission: async (request) => {
        seenDetail = request.detail;
        return 'allow';
      },
    });
    const context = buildPermissionRequestContext('mcp:tool-call', seenDetail);
    expect(context.kind).toBe('mcp');
    expect(context.mcpTool?.serverId).toBe('docs');
    expect(context.mcpTool?.toolName).toBe('write_page');
    expect(context.mcpTool?.argumentsSummary).toContain('[redacted]');
  });

  it('empty ruleset (no MCP rules) allows without prompt', async () => {
    let permissionCalls = 0;
    const target = await assertMcpToolCallAllowed({
      serverId: 'docs',
      toolName: 'unknown_tool',
      arguments: {},
      rules: createEmptyRuleSet(),
      requestPermission: async () => {
        permissionCalls += 1;
        return 'allow';
      },
    });
    expect(permissionCalls).toBe(0);
    expect(target.selector).toBe('docs.unknown_tool');
  });
});
