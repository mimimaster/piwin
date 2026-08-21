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

    expect(proxyCall).toHaveBeenCalledWith(
      'sess-1',
      'tc-1',
      'web_search',
      { query: 'piwin' },
      undefined,
    );
    expect(result.content).toEqual([{ type: 'text', text: 'search results here' }]);
    expect(result.details).toMatchObject({ toolName: 'web_search', proxied: true });
  });

  it('forwards tool-result images into Pi content for vision closed-loop', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: true as true,
      output: '{"inspect":{"status":"native"}}',
      details: { attachments: [] },
      images: [{ mimeType: 'image/jpeg', dataBase64: '/9j/QQ==' }],
    }));
    const tools = buildWorkerProxyTools(
      blueprintWithTools(['browser_screenshot']),
      proxyCall,
      'sess-1',
    );
    const result = await tools[0]!.execute('tc-shot', {}, undefined, undefined, undefined);
    expect(result.content).toEqual([
      { type: 'text', text: '{"inspect":{"status":"native"}}' },
      { type: 'image', mimeType: 'image/jpeg', data: '/9j/QQ==' },
    ]);
    expect(JSON.stringify(result.details)).not.toContain('/9j/QQ==');
  });

  it('proxy executor throws permission-denied so Pi marks the tool as failed', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'permission-denied' as const,
      message: 'user denied bash execution',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['bash']), proxyCall, 'sess-1');
    const tool = tools[0]!;

    await expect(
      tool.execute('tc-1', { command: 'rm -rf /' }, undefined, undefined, undefined),
    ).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      message: 'Permission denied: user denied bash execution',
    });
  });

  it('proxy executor throws aborted executions so Pi marks the tool as failed', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'aborted' as const,
      message: 'tool execution aborted',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['web_search']), proxyCall, 'sess-1');

    await expect(
      tools[0]!.execute('tc', {}, undefined, undefined, undefined),
    ).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      message: 'Tool execution aborted',
    });
  });

  it('proxy executor throws tool-not-available so Pi marks the tool as failed', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'tool-not-available' as const,
      message: 'tool not in registry',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['missing_tool']), proxyCall, 'sess-1');

    await expect(
      tools[0]!.execute('tc', {}, undefined, undefined, undefined),
    ).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      message: 'Tool not available: tool not in registry',
    });
  });

  it('proxy executor throws tool-disabled so Pi marks the tool as failed', async () => {
    const proxyCall: ToolProxyCall = vi.fn(async () => ({
      ok: false as false,
      code: 'tool-disabled' as const,
      message: 'web tools family disabled',
    }));
    const tools = buildWorkerProxyTools(blueprintWithTools(['web_search']), proxyCall, 'sess-1');

    await expect(
      tools[0]!.execute('tc', {}, undefined, undefined, undefined),
    ).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      message: 'Tool disabled: web tools family disabled',
    });
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
