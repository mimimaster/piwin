import { describe, expect, it } from 'vitest';
import {
  collectSessionTools,
  looksLikeArgsDumpSummary,
  recoverSummaryFromInputPreview,
  resolveToolCallHeaderPreview,
  resolveToolOpenPath,
} from './tool-call-card';
import type { ToolCardUi } from './chat-reducer';

describe('collectSessionTools', () => {
  it('flattens tools from all messages in order', () => {
    const first: ToolCardUi = {
      toolCallId: 'a',
      toolName: 'bash',
      status: 'done',
      output: 'ok',
    };
    const second: ToolCardUi = {
      toolCallId: 'b',
      toolName: 'read',
      status: 'running',
      output: '',
    };
    const tools = collectSessionTools([
      { tools: [first] },
      { tools: [] },
      { tools: [second] },
    ]);
    expect(tools).toEqual([first, second]);
  });
});

describe('resolveToolCallHeaderPreview', () => {
  const shellCommand =
    'cd /Users/me/.piwin/workspace && python3 lru_cache_with_ttl.py 2>&1 | tail -20; echo "exit=$?"';

  it('shows shell command preview while collapsed', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: shellCommand,
        displayName: 'Bash',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: false,
        hasDetailInBody: true,
      }),
    ).toBe(shellCommand);
  });

  it('hides shell command preview while expanded (body owns the full command)', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: shellCommand,
        displayName: 'Bash',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: true,
        hasDetailInBody: true,
      }),
    ).toBe('');
  });

  it('keeps search query preview while expanded when body has no command block', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'lru cache ttl',
        displayName: 'Grep',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: true,
        hasDetailInBody: false,
      }),
    ).toBe('lru cache ttl');
  });

  it('never shows raw MCP args dump in the header (collapsed or expanded)', () => {
    const argsDump = '{"project":"piwin"}';
    expect(
      resolveToolCallHeaderPreview({
        summary: argsDump,
        displayName: 'agent-memory / agent_memory_get_context',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: false,
        hasDetailInBody: true,
        isArgsDumpSummary: true,
      }),
    ).toBe('');
    expect(
      resolveToolCallHeaderPreview({
        summary: argsDump,
        displayName: 'agent-memory / agent_memory_get_context',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: true,
        hasDetailInBody: true,
        isArgsDumpSummary: true,
      }),
    ).toBe('');
  });

  it('shows MCP tool name in header while collapsed', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'agent_memory_get_context',
        displayName: 'agent-memory / agent_memory_get_context',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: false,
        hasDetailInBody: true,
        isArgsDumpSummary: false,
      }),
    ).toBe('agent_memory_get_context');
  });
});

describe('looksLikeArgsDumpSummary', () => {
  it('detects JSON object/array dumps', () => {
    expect(looksLikeArgsDumpSummary('{"project":"piwin"}')).toBe(true);
    expect(looksLikeArgsDumpSummary('[1, 2]')).toBe(true);
    expect(looksLikeArgsDumpSummary('agent_memory_get_context')).toBe(false);
    expect(looksLikeArgsDumpSummary('ls -la')).toBe(false);
  });

  it('detects clipSummary-truncated JSON dumps that no longer close braces', () => {
    expect(
      looksLikeArgsDumpSummary(
        '{ "paths": [ "/Users/me/.piwin/media/session-1/f8d3cd99-537f-42cc-bc5c-b…',
      ),
    ).toBe(true);
    expect(looksLikeArgsDumpSummary('{"prompt":"a long prompt that got cut…')).toBe(true);
    expect(looksLikeArgsDumpSummary('[ "/tmp/a.png", "/tmp/b…')).toBe(true);
  });
});

describe('recoverSummaryFromInputPreview', () => {
  it('extracts prompt from image_gen inputPreview JSON', () => {
    expect(
      recoverSummaryFromInputPreview(
        JSON.stringify({
          prompt: 'Makima tying hair in a bathroom, business attire',
        }),
      ),
    ).toBe('Makima tying hair in a bathroom, business attire');
  });

  it('extracts prompt from clipSummary-truncated inputPreview', () => {
    expect(
      recoverSummaryFromInputPreview(
        '{"prompt":"Photorealistic personal life photo of Makima from Chainsaw Man: a young woman with l…',
      ),
    ).toContain('Photorealistic personal life photo of Makima');
  });

  it('returns undefined for non-JSON or prompt-less previews', () => {
    expect(recoverSummaryFromInputPreview('not json')).toBeUndefined();
    expect(recoverSummaryFromInputPreview(JSON.stringify({ n: 1 }))).toBeUndefined();
    expect(recoverSummaryFromInputPreview(undefined)).toBeUndefined();
  });
});

describe('resolveToolOpenPath', () => {
  it('joins project-relative paths to the project root', () => {
    expect(resolveToolOpenPath('pelican-bicycle-animation.html', '/workspace')).toEqual({
      absolutePath: '/workspace/pelican-bicycle-animation.html',
      relativePath: 'pelican-bicycle-animation.html',
    });
  });

  it('keeps absolute paths and derives a project-relative path when under the root', () => {
    expect(
      resolveToolOpenPath('/workspace/apps/desktop/src/App.tsx', '/workspace'),
    ).toEqual({
      absolutePath: '/workspace/apps/desktop/src/App.tsx',
      relativePath: 'apps/desktop/src/App.tsx',
    });
  });

  it('returns the raw path when no project root is available', () => {
    expect(resolveToolOpenPath('src/App.tsx')).toEqual({
      absolutePath: 'src/App.tsx',
      relativePath: 'src/App.tsx',
    });
  });
});
