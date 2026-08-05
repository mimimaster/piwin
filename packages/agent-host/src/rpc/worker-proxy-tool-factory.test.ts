import { describe, expect, it, vi } from 'vitest';
import type { SerializableBlueprint } from './serializable-blueprint.js';
import { buildWorkerProxyTools, buildSingleProxyTool } from './worker-proxy-tool-factory.js';
import type { ToolProxyCall } from './worker-proxy-tool-factory.js';

function blueprintWithTools(toolNames: string[]): SerializableBlueprint {
  return {
    protocolVersion: 1,
    snapshotId: 'snap-1',
    settingsRevision: 'r1',
    workingDirectory: '/tmp/work',
    scope: { kind: 'general' },
    resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
    contextManifest: { agentsFiles: [] },
    tools: {
      enabledFamilies: [],
      piBuiltinToolNames: [],
      hostTools: toolNames.map((name) => ({ name, description: '', parameters: {} })),
      enabledMcpServerIds: [],
    },
    activeSkillPaths: [],
    activeExtensionPaths: [],
    activePromptPaths: [],
  };
}

describe('buildWorkerProxyTools', () => {
  it('returns an empty array when hostTools is empty (P7-08)', () => {
    const proxyCall = vi.fn();
    const tools = buildWorkerProxyTools(blueprintWithTools([]), proxyCall, 'sess-1');
    expect(tools).toEqual([]);
  });

  it('builds one proxy tool per Host tool descriptor', () => {
    const proxyCall = vi.fn();
    const tools = buildWorkerProxyTools(
      blueprintWithTools(['web_search', 'web_fetch', 'mcp__server__tool']),
      proxyCall,
      'sess-1',
    );
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'mcp__server__tool',
      'web_fetch',
      'web_search',
    ]);
  });

  it('proxy executor calls the parent and returns the output', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: true as true,
      output: 'search results here',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['web_search']), proxyCall, 'sess-1');
    const tool = tools[0]!;

    const result = await tool.execute('tc-1', { query: 'piwin' }, undefined, undefined, undefined);

    expect(proxyCall).toHaveBeenCalledWith('sess-1', 'web_search', { query: 'piwin' }, undefined);
    expect(result.content).toEqual([{ type: 'text', text: 'search results here' }]);
    expect(result.details).toMatchObject({ toolName: 'web_search', proxied: true });
  });

  it('proxy executor maps permission-denied to model-facing error text', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'permission-denied' as const,
      message: 'user denied bash execution',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['bash']), proxyCall, 'sess-1');
    const tool = tools[0]!;

    const result = await tool.execute(
      'tc-1',
      { command: 'rm -rf /' },
      undefined,
      undefined,
      undefined,
    );

    expect(result.content[0]?.text).toContain('Permission denied');
    expect(result.details).toMatchObject({ error: 'permission-denied' });
  });

  it('proxy executor maps aborted to clean abort message', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'aborted' as const,
      message: 'tool execution aborted',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['web_search']), proxyCall, 'sess-1');

    const result = await tools[0]!.execute('tc', {}, undefined, undefined, undefined);

    expect(result.content[0]?.text).toContain('aborted');
  });

  it('proxy executor maps tool-not-available to error text', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'tool-not-available' as const,
      message: 'tool not in registry',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['missing_tool']), proxyCall, 'sess-1');

    const result = await tools[0]!.execute('tc', {}, undefined, undefined, undefined);

    expect(result.content[0]?.text).toContain('Tool not available');
  });

  it('proxy executor maps tool-disabled to error text', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'tool-disabled' as const,
      message: 'web tools family disabled',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['web_search']), proxyCall, 'sess-1');

    const result = await tools[0]!.execute('tc', {}, undefined, undefined, undefined);

    expect(result.content[0]?.text).toContain('Tool disabled');
  });
});

describe('buildSingleProxyTool', () => {
  it('preserves the complete descriptor schema', () => {
    const proxyCall = vi.fn();
    const parameters = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    };
    const tool = buildSingleProxyTool(
      { name: 'web_search', description: 'Search', parameters },
      proxyCall,
      'sess-1',
    );
    expect(tool.parameters).toEqual(parameters);
    expect(tool.name).toBe('web_search');
  });
});
