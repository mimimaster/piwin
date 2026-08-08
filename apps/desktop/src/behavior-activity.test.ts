import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_ACTIVITY_REGISTRY,
  behaviorTextClass,
  localizeBehaviorAction,
  resolveRunBehaviorId,
  resolveToolBehaviorId,
  resolveToolBehaviorStateId,
} from './behavior-activity.js';

describe('behavior activity registry', () => {
  it('keeps every registry entry addressable by its stable id', () => {
    for (const [id, entry] of Object.entries(BEHAVIOR_ACTIVITY_REGISTRY)) {
      expect(entry.id).toBe(id);
      expect(entry.labelZh.length).toBeGreaterThan(0);
      expect(entry.labelEn.length).toBeGreaterThan(0);
    }
  });

  it('maps normalized tool presentations without parsing raw Pi events in UI', () => {
    expect(
      resolveToolBehaviorId({
        kind: 'mcp',
        toolName: 'mcp__github__search',
        actionVerb: 'MCP (github)',
      }),
    ).toBe('mcp.call');
    expect(
      resolveToolBehaviorId({
        kind: 'mcp',
        toolName: 'mcp_gateway',
        actionVerb: 'MCP discovery',
      }),
    ).toBe('mcp.discovery');
    expect(
      resolveToolBehaviorId({ kind: 'mcp', toolName: 'mcp_gateway', actionVerb: 'MCP status' }),
    ).toBe('mcp.server.status');
    expect(
      resolveToolBehaviorId({ kind: 'web', toolName: 'web_search', actionVerb: 'Searched' }),
    ).toBe('web.search');
    expect(
      resolveToolBehaviorId({ kind: 'web', toolName: 'web_fetch', actionVerb: 'Fetched' }),
    ).toBe('web.fetch');
    expect(
      resolveToolBehaviorId({
        kind: 'filesystem',
        toolName: 'write_to_file',
        actionVerb: 'Edited',
      }),
    ).toBe('edit');
    expect(
      resolveToolBehaviorId({ kind: 'shell', toolName: 'bash', actionVerb: 'Ran command' }),
    ).toBe('shell');
    expect(
      resolveToolBehaviorId({ kind: 'process', toolName: 'pnpm test', actionVerb: 'Ran command' }),
    ).toBe('test');
    expect(
      resolveToolBehaviorId({ kind: 'shell', toolName: 'pnpm build', actionVerb: 'Ran command' }),
    ).toBe('build');
    expect(
      resolveToolBehaviorId({ kind: 'other', toolName: 'custom_tool', actionVerb: 'Custom tool' }),
    ).toBe('tool.other');
  });

  it('localizes the action family with dedicated MCP and Subagent labels', () => {
    expect(localizeBehaviorAction('mcp.call', 'zh-CN', 'MCP (github)')).toBe('调用');
    expect(localizeBehaviorAction('mcp.call', 'en', 'MCP (github)')).toBe('Calling');
    expect(localizeBehaviorAction('mcp.discovery', 'zh-CN')).toBe('发现 MCP 工具');
    expect(localizeBehaviorAction('subagent.task.running', 'en')).toBe('Working');
    expect(localizeBehaviorAction('edit', 'zh-CN')).toBe('修改');
    expect(localizeBehaviorAction('edit', 'en')).toBe('Edited');
    expect(localizeBehaviorAction('test', 'zh-CN')).toBe('测试');
    expect(localizeBehaviorAction('build', 'en')).toBe('Built');
  });

  it('uses motion only while a behavior is active', () => {
    expect(behaviorTextClass('search', true)).toBe('behavior-search-active');
    expect(behaviorTextClass('search', false)).toBe('behavior-done');
    expect(behaviorTextClass('mcp.call', true)).toBe('behavior-mcp-active');
    expect(behaviorTextClass('mcp.discovery', true)).toBe('behavior-mcp-discovery-active');
    expect(behaviorTextClass('permission', true)).toBe('behavior-gate-active');
    expect(behaviorTextClass('tool.other', true)).toBe('behavior-generic-active');
    expect(resolveToolBehaviorStateId('mcp.call', 'done')).toBe('mcp.call.done');
    expect(resolveToolBehaviorStateId('mcp.call', 'error')).toBe('mcp.call.error');
  });

  it('maps run lifecycle states to locator behavior ids', () => {
    expect(resolveRunBehaviorId('preparing')).toBe('run.prepare');
    expect(resolveRunBehaviorId('connecting-model')).toBe('run.connect');
    expect(resolveRunBehaviorId('waiting-first-token')).toBe('run.wait-token');
    expect(resolveRunBehaviorId('working')).toBe('run.running');
    expect(resolveRunBehaviorId('failed')).toBe('run.fail');
  });
});
