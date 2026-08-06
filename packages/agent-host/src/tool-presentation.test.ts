import { describe, expect, it } from 'vitest';
import {
  boundToolOutput,
  buildToolPresentation,
  classifyToolKind,
  formatPathsSummary,
  redactToolText,
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
    expect(classifyToolKind('image_gen')).toBe('other');
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

describe('buildToolPresentation', () => {
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

  it('presents video_gen with prompt summary', () => {
    expect(classifyToolKind('video_gen')).toBe('other');
    const presentation = buildToolPresentation({
      toolName: 'video_gen',
      args: { prompt: 'a paper boat crossing a river' },
    });
    expect(presentation.actionVerb).toBe('Generated video');
    expect(presentation.summary).toContain('paper boat');
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
      outputText:
        'Command aborted: A newer user message started, so this run was interrupted.',
      isError: true,
    });
    expect(presentation.error?.category).toBe('cancelled');
    expect(presentation.summary).toBe('Cancelled before completion');
    expect(presentation.error?.message.toLowerCase()).toContain('newer user message');
  });
});
