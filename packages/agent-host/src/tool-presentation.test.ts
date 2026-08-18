import { describe, expect, it } from 'vitest';
import {
  boundToolOutput,
  buildToolPresentation,
  classifyToolKind,
  formatPathsSummary,
  redactToolText,
  resolvePresentedToolInvocation,
} from './tool-presentation.js';

describe('classifyToolKind', () => {
  it('classifies known tools without inventing from substrings', () => {
    expect(classifyToolKind('bash')).toBe('shell');
    expect(classifyToolKind('read')).toBe('filesystem');
    expect(classifyToolKind('grep')).toBe('filesystem');
    expect(classifyToolKind('glob')).toBe('filesystem');
    expect(classifyToolKind('git_status')).toBe('git');
    expect(classifyToolKind('web_search')).toBe('web');
    expect(classifyToolKind('web_fetch')).toBe('web');
    expect(classifyToolKind('mcp__server__tool')).toBe('mcp');
    expect(classifyToolKind('github.search')).toBe('mcp');
    expect(classifyToolKind('image_gen')).toBe('image');
    expect(classifyToolKind('piwin_subagent_run')).toBe('subagent');
    expect(classifyToolKind('mystery_tool')).toBe('other');
    // Must not treat a random name containing "file" as filesystem.
    expect(classifyToolKind('profile_loader')).toBe('other');
  });
});

describe('formatPathsSummary', () => {
  it('formats multi-file lists like Cursor', () => {
    expect(formatPathsSummary(['a/b/c.tsx'])).toBe('c.tsx');
    expect(formatPathsSummary(['a/x.ts', 'b/y.ts'])).toBe('x.ts and y.ts');
    expect(formatPathsSummary(['a/x.ts', 'b/y.ts', 'c/z.ts'])).toBe('x.ts and 2 other files');
  });
});

describe('resolvePresentedToolInvocation', () => {
  it('unwraps valid toolbox calls for presentation only', () => {
    expect(
      resolvePresentedToolInvocation('piwin_toolbox', {
        action: 'call',
        target: 'image_gen',
        arguments: { prompt: 'a red cube', api_key: 'sk-abcdefghijklmnopqrstuvwxyz' },
      }),
    ).toEqual({
      invokedToolName: 'piwin_toolbox',
      effectiveToolName: 'image_gen',
      effectiveArgs: { prompt: 'a red cube', api_key: 'sk-abcdefghijklmnopqrstuvwxyz' },
      routedToolName: 'image_gen',
    });
  });

  it('unwraps catalog MCP calls the same way as Host targets', () => {
    expect(
      resolvePresentedToolInvocation('piwin_toolbox', {
        action: 'call',
        target: 'github.search',
        arguments: { query: 'AgentEvent' },
      }),
    ).toEqual({
      invokedToolName: 'piwin_toolbox',
      effectiveToolName: 'github.search',
      effectiveArgs: { query: 'AgentEvent' },
      routedToolName: 'github.search',
    });
  });

  it('leaves describe and malformed toolbox calls unchanged', () => {
    const describeArgs = { action: 'describe', target: 'image_gen' };
    expect(resolvePresentedToolInvocation('piwin_toolbox', describeArgs)).toEqual({
      invokedToolName: 'piwin_toolbox',
      effectiveToolName: 'piwin_toolbox',
      effectiveArgs: describeArgs,
    });
    expect(
      resolvePresentedToolInvocation('piwin_toolbox', {
        action: 'call',
        target: 'image_gen',
        arguments: [],
      }).routedToolName,
    ).toBeUndefined();
  });
});

describe('buildToolPresentation', () => {
  it('builds a typed delegation presentation from the task', () => {
    expect(
      buildToolPresentation({
        toolName: 'piwin_subagent_run',
        args: { task: 'Explore project structure', role: 'explorer' },
      }),
    ).toMatchObject({
      kind: 'subagent',
      title: 'Subagent',
      actionVerb: 'Delegated',
      summary: 'Explore project structure',
    });
  });

  it('builds shell presentation with command and exit code', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      args: { command: 'ls -la' },
      outputText: 'README.md',
      exitCode: 0,
    });
    expect(presentation.kind).toBe('shell');
    expect(presentation.actionVerb).toBe('Ran command');
    expect(presentation.command).toBe('ls -la');
    expect(presentation.summary).toBe('ls -la');
    expect(presentation.exitCode).toBe(0);
    expect(presentation.output?.text).toContain('README');
  });

  it('builds filesystem presentation with target paths', () => {
    const presentation = buildToolPresentation({
      toolName: 'read',
      args: { path: 'src/App.tsx' },
    });
    expect(presentation.kind).toBe('filesystem');
    expect(presentation.actionVerb).toBe('Read');
    expect(presentation.targetPaths).toEqual(['src/App.tsx']);
    expect(presentation.summary).toBe('App.tsx');
    expect(presentation.changedPaths).toBeUndefined();
  });

  it('sets changedPaths for successful write/edit tools', () => {
    const write = buildToolPresentation({
      toolName: 'write',
      args: { path: 'src/foo.ts' },
      outputText: 'ok',
    });
    expect(write.actionVerb).toBe('Edited');
    expect(write.changedPaths).toEqual(['src/foo.ts']);
    expect(write.targetPaths).toEqual(['src/foo.ts']);

    const edit = buildToolPresentation({
      toolName: 'edit',
      args: { file_path: 'packages/bar.ts' },
    });
    expect(edit.changedPaths).toEqual(['packages/bar.ts']);
  });

  it('does not set changedPaths on write errors', () => {
    const presentation = buildToolPresentation({
      toolName: 'write',
      args: { path: 'src/foo.ts' },
      isError: true,
      outputText: 'permission denied',
    });
    expect(presentation.targetPaths).toEqual(['src/foo.ts']);
    expect(presentation.changedPaths).toBeUndefined();
  });

  it('redacts secrets in output', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      args: { command: 'echo hi' },
      outputText: 'api_key=sk-abcdefghijklmnopqrstuvwxyz',
      isError: false,
    });
    expect(presentation.output?.text).toContain('[redacted]');
    expect(presentation.output?.redacted).toBe(true);
  });

  it('marks errors', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      isError: true,
      outputText: 'command failed',
    });
    expect(presentation.error?.category).toBe('execution');
  });

  it('extracts actionVerb, query summary and countTag for search tools', () => {
    const presentation = buildToolPresentation({
      toolName: 'grep_search',
      args: { Query: 'TurnToolGroup', StartLine: 1, EndLine: 90 },
      outputText: JSON.stringify([
        { file: 'turn-tool-group.tsx' },
        { file: 'turn-work-details.tsx' },
      ]),
    });
    expect(presentation.kind).toBe('filesystem');
    expect(presentation.actionVerb).toBe('Searched');
    expect(presentation.summary).toBe('TurnToolGroup');
    expect(presentation.lineRange).toBe('L1-90');
    expect(presentation.countTag).toBe('2 results');
  });

  it('presents read as Read with path summary (not raw output)', () => {
    const presentation = buildToolPresentation({
      toolName: 'read',
      args: { path: 'apps/desktop/src/turn-work-details.tsx' },
      outputText: 'export function TurnWorkDetails() { /* huge body */ }',
    });
    expect(presentation.actionVerb).toBe('Read');
    expect(presentation.summary).toBe('turn-work-details.tsx');
    expect(presentation.targetPaths).toEqual(['apps/desktop/src/turn-work-details.tsx']);
  });

  it('formats multi-file read as "file and N other files"', () => {
    const presentation = buildToolPresentation({
      toolName: 'read',
      args: {
        paths: [
          'apps/desktop/src/turn-work-details.tsx',
          'apps/desktop/src/tool-call-card.tsx',
          'apps/desktop/src/shell-icons.tsx',
        ],
      },
    });
    expect(presentation.actionVerb).toBe('Read');
    expect(presentation.summary).toBe('turn-work-details.tsx and 2 other files');
    expect(presentation.countTag).toBe('3 files');
  });

  it('presents glob as Explored with intact pattern', () => {
    const presentation = buildToolPresentation({
      toolName: 'glob',
      args: { glob_pattern: '**/*tool-group*' },
      outputText: 'a\nb\nc',
    });
    expect(presentation.actionVerb).toBe('Explored');
    expect(presentation.summary).toBe('**/*tool-group*');
    expect(presentation.countTag).toBe('3 files');
  });

  it('presents web_fetch with URL summary', () => {
    const presentation = buildToolPresentation({
      toolName: 'web_fetch',
      args: { url: 'https://example.com/docs/api' },
      outputText: '<html>…</html>',
    });
    expect(presentation.kind).toBe('web');
    expect(presentation.actionVerb).toBe('Fetched');
    expect(presentation.summary).toBe('https://example.com/docs/api');
  });

  it('presents git tools with specific verbs', () => {
    const status = buildToolPresentation({
      toolName: 'git_status',
      outputText: ' M file.ts',
    });
    expect(status.kind).toBe('git');
    expect(status.actionVerb).toBe('Git status');

    const commit = buildToolPresentation({
      toolName: 'git',
      args: { command: 'commit -m "fix"' },
    });
    expect(commit.actionVerb).toBe('Git commit');
  });

  it('presents image_gen with prompt summary', () => {
    const presentation = buildToolPresentation({
      toolName: 'image_gen',
      args: { prompt: 'a red cube on a table' },
    });
    expect(presentation.actionVerb).toBe('Generated image');
    expect(presentation.summary).toBe('a red cube on a table');
  });

  it('presents routed toolbox image/video calls from inner arguments', () => {
    const imageInvocation = resolvePresentedToolInvocation('piwin_toolbox', {
      action: 'call',
      target: 'image_gen',
      arguments: { prompt: 'a wasteland portrait', token: 'top-secret' },
    });
    const image = buildToolPresentation({
      toolName: imageInvocation.effectiveToolName,
      args: imageInvocation.effectiveArgs,
      ...(imageInvocation.routedToolName !== undefined
        ? { routedToolName: imageInvocation.routedToolName }
        : {}),
    });
    expect(image).toMatchObject({
      kind: 'image',
      title: 'image_gen',
      routedToolName: 'image_gen',
      summary: 'a wasteland portrait',
    });
    expect(image.inputPreview).toContain('[redacted]');
    expect(image.inputPreview).not.toContain('piwin_toolbox');

    const videoInvocation = resolvePresentedToolInvocation('piwin_toolbox', {
      action: 'call',
      target: 'video_gen',
      arguments: { prompt: 'a paper boat crossing a river' },
    });
    expect(
      buildToolPresentation({
        toolName: videoInvocation.effectiveToolName,
        args: videoInvocation.effectiveArgs,
        ...(videoInvocation.routedToolName !== undefined
          ? { routedToolName: videoInvocation.routedToolName }
          : {}),
      }),
    ).toMatchObject({ kind: 'video', routedToolName: 'video_gen' });
  });

  it('records unknown routed targets but keeps other semantics', () => {
    const invocation = resolvePresentedToolInvocation('piwin_toolbox', {
      action: 'call',
      target: 'custom_low_frequency_tool',
      arguments: { value: 1 },
    });
    expect(
      buildToolPresentation({
        toolName: invocation.effectiveToolName,
        args: invocation.effectiveArgs,
        ...(invocation.routedToolName !== undefined
          ? { routedToolName: invocation.routedToolName }
          : {}),
      }),
    ).toMatchObject({ kind: 'other', routedToolName: 'custom_low_frequency_tool' });
  });

  it('does not use image_gen paths JSON as summary when args are missing', () => {
    const presentation = buildToolPresentation({
      toolName: 'image_gen',
      outputText: JSON.stringify(
        {
          paths: ['/Users/me/.piwin/media/session-1/asset.png'],
          mimeType: 'image/png',
          byteSize: 2048,
        },
        null,
        2,
      ),
    });
    expect(presentation.actionVerb).toBe('Generated image');
    expect(presentation.summary).toBeUndefined();
    expect(presentation.output?.text).toContain('paths');
  });

  it('never promotes raw tool output into the transcript row title', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      outputText: 'total 216\ndrwxr-xr-x 7 user staff 224 Aug 11 19:55 .',
    });

    expect(presentation.actionVerb).toBe('Ran command');
    expect(presentation.summary).toBeUndefined();
    expect(presentation.output?.text).toContain('total 216');
  });

  it('keeps image_gen prompt summary when both args and paths output are present', () => {
    const presentation = buildToolPresentation({
      toolName: 'image_gen',
      args: { prompt: 'Makima tying hair in a bathroom, business attire' },
      outputText: JSON.stringify({
        paths: ['/tmp/.piwin/media/s1/a.png'],
        mimeType: 'image/png',
        byteSize: 128,
      }),
    });
    expect(presentation.summary).toBe('Makima tying hair in a bathroom, business attire');
  });

  it('presents video_gen with prompt summary', () => {
    expect(classifyToolKind('video_gen')).toBe('video');
    const presentation = buildToolPresentation({
      toolName: 'video_gen',
      args: { prompt: 'a paper boat crossing a river' },
    });
    expect(presentation.actionVerb).toBe('Generated video');
    expect(presentation.summary).toContain('paper boat');
  });

  it('does not use video_gen paths JSON as summary when args are missing', () => {
    const presentation = buildToolPresentation({
      toolName: 'video_gen',
      outputText: JSON.stringify({ paths: ['/tmp/video.mp4'], mimeType: 'video/mp4' }),
    });
    expect(presentation.actionVerb).toBe('Generated video');
    expect(presentation.summary).toBeUndefined();
  });

  it('presents MCP tools with server label', () => {
    const presentation = buildToolPresentation({
      toolName: 'mcp__agent-memory__agent_memory_get_context',
      args: { query: 'prefs' },
    });
    expect(presentation.kind).toBe('mcp');
    expect(presentation.actionVerb).toBe('MCP (agent-memory)');
    expect(presentation.summary).toBe('agent_memory_get_context');
    expect(presentation.inputPreview).toContain('prefs');
  });

  it('presents MCP gateway discovery separately from an MCP tool call', () => {
    const discovery = buildToolPresentation({
      toolName: 'mcp_gateway',
      args: { action: 'search', query: 'AgentEvent' },
    });
    const call = buildToolPresentation({
      toolName: 'mcp_gateway',
      args: { action: 'call', selector: 'github.search', arguments: { query: 'AgentEvent' } },
    });

    expect(discovery.kind).toBe('mcp');
    expect(discovery.actionVerb).toBe('MCP discovery');
    expect(discovery.summary).toBe('AgentEvent');
    expect(call.kind).toBe('mcp');
    expect(call.actionVerb).toBe('MCP call');
    expect(call.summary).toBe('github.search');
    expect(call.inputPreview).toContain('github.search');
  });

  it('presents catalog search as discovery and routed MCP calls as MCP tools', () => {
    const discovery = buildToolPresentation({
      toolName: 'piwin_toolbox',
      args: { action: 'search', query: 'flashcard' },
    });
    const mcpInvocation = resolvePresentedToolInvocation('piwin_toolbox', {
      action: 'call',
      target: 'github.search',
      arguments: { query: 'AgentEvent' },
    });
    const mcpCall = buildToolPresentation({
      toolName: mcpInvocation.effectiveToolName,
      args: mcpInvocation.effectiveArgs,
      ...(mcpInvocation.routedToolName !== undefined
        ? { routedToolName: mcpInvocation.routedToolName }
        : {}),
    });

    expect(discovery.actionVerb).toBe('Tool discovery');
    expect(discovery.summary).toBe('flashcard');
    expect(mcpCall.kind).toBe('mcp');
    expect(mcpCall.actionVerb).toBe('MCP (github)');
    expect(mcpCall.summary).toBe('search');
    expect(mcpCall.routedToolName).toBe('github.search');
  });

  it('does not dump raw MCP JSON args into the header summary', () => {
    const withTool = buildToolPresentation({
      toolName: 'mcp__agent-memory__agent_memory_get_context',
      args: { project: 'piwin' },
    });
    expect(withTool.summary).toBe('agent_memory_get_context');
    expect(withTool.summary).not.toContain('project');
    expect(withTool.inputPreview).toContain('project');

    // Server-only name (no tool segment) must not fall back to JSON summary.
    const serverOnly = buildToolPresentation({
      toolName: 'mcp__agent-memory',
      args: { project: 'piwin' },
    });
    expect(serverOnly.actionVerb).toBe('MCP (agent-memory)');
    expect(serverOnly.summary).toBeUndefined();
    expect(serverOnly.inputPreview).toBe('{"project":"piwin"}');
  });

  it('marks a successful web fetch result as truncated in the tool view', () => {
    const presentation = buildToolPresentation({
      toolName: 'web_fetch',
      args: { url: 'https://example.com/docs' },
      outputText: JSON.stringify({
        url: 'https://example.com/docs',
        finalUrl: 'https://example.com/docs',
        title: 'Docs',
        text: 'partial content',
        contentType: 'text/plain',
        byteSize: 262144,
        truncated: true,
        truncationReason: 'response-limit',
      }),
    });

    expect(presentation.output?.truncated).toBe(true);
  });
});

describe('redactToolText / boundToolOutput', () => {
  it('bounds very long output', () => {
    const long = 'x'.repeat(20_000);
    const bounded = boundToolOutput(long);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text.length).toBeLessThan(long.length);
  });

  it('redacts bearer tokens', () => {
    const result = redactToolText('Authorization: Bearer abcdefghijklmnop');
    expect(result.redacted).toBe(true);
    expect(result.text).toContain('[redacted]');
  });
});

describe('buildToolPresentation cancel', () => {
  it('marks aborted bash output as cancelled', async () => {
    const { buildToolPresentation } = await import('./tool-presentation.js');
    const presentation = buildToolPresentation({
      toolName: 'bash',
      args: { command: 'pnpm test' },
      outputText: 'Command aborted: A newer user message started, so this run was interrupted.',
      isError: true,
    });
    expect(presentation.error?.category).toBe('cancelled');
    expect(presentation.summary).toBe('Cancelled before completion');
    expect(presentation.error?.message.toLowerCase()).toContain('newer user message');
  });
});
