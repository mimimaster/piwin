import { describe, expect, it } from 'vitest';
import {
  formatChainPreviewChip,
  humanizeToolCallName,
  kindVerb,
  looksLikeArgsDumpSummary,
  recoverSummaryFromInputPreview,
  resolveMcpHeaderPreview,
  resolveToolCallHeaderPreview,
} from './tool-call-head';
import { formatToolOutputTruncation } from './tool-output-truncation-display.js';

describe('formatChainPreviewChip', () => {
  it('strips a leading cd && so the chip shows the real command', () => {
    expect(formatChainPreviewChip("cd /Users/me/Developer/piwin && pnpm typecheck")).toBe(
      'pnpm typecheck',
    );
  });

  it('clips long commands after stripping cd', () => {
    const clipped = formatChainPreviewChip(
      'cd /Users/me/piwin && pnpm exec vitest run src/styles/inkstone/tool-timeline.test.ts src/explore-flow-capsule.test.tsx',
      40,
    );
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(40);
    expect(clipped.startsWith('pnpm')).toBe(true);
  });
});

describe('formatToolOutputTruncation', () => {
  it('keeps the collapsed label on one line and explains continuation in detail', () => {
    const copy = formatToolOutputTruncation({
      locale: 'zh-CN',
      isRead: true,
      isWeb: false,
      truncation: {
        reason: 'line-limit',
        shownLines: { start: 1, end: 2000 },
        totalLines: 6280,
        nextOffset: 2001,
        limitLines: 2000,
      },
    });

    expect(copy.summary).toBe('部分内容 · L1–L2000 / 共 6280 行');
    expect(copy.notice).toContain('文件未修改');
    expect(copy.notice).toContain('第 2001 行');
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
      }),
    ).toBe('');
  });

  it('hides search query preview while expanded', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'lru cache ttl',
        displayName: 'Grep',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: true,
      }),
    ).toBe('');
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
        isArgsDumpSummary: false,
      }),
    ).toBe('agent_memory_get_context');
  });

  it('hides MCP identity preview while expanded', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'github / search · piwin',
        displayName: 'github / search',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: true,
        keepTitlePreview: true,
      }),
    ).toBe('');
  });

  it('keeps MCP identity preview when it repeats the title on a collapsed row', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'agent-memory / agent_memory_get_context',
        displayName: 'agent-memory / agent_memory_get_context',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: false,
        keepTitlePreview: true,
      }),
    ).toBe('agent-memory / agent_memory_get_context');
  });
});

describe('resolveMcpHeaderPreview', () => {
  it('uses the humanized MCP title as the collapsed identity', () => {
    expect(
      resolveMcpHeaderPreview({
        displayName: 'agent-memory / agent_memory_get_context',
        toolName: 'mcp__agent-memory__agent_memory_get_context',
        summary: 'agent_memory_get_context',
      }),
    ).toBe('agent-memory / agent_memory_get_context');
  });

  it('appends a short query snippet instead of dumping JSON args', () => {
    expect(
      resolveMcpHeaderPreview({
        displayName: 'github / search',
        toolName: 'mcp__github__search',
        summary: '{"query":"piwin"}',
        inputPreview: '{"query":"piwin"}',
      }),
    ).toBe('github / search · piwin');
  });

  it('falls back to the selector/query when the title is the generic gateway', () => {
    expect(
      resolveMcpHeaderPreview({
        displayName: 'MCP gateway',
        toolName: 'mcp_gateway',
        summary: 'github.search',
        inputPreview: '{"action":"call","selector":"github.search"}',
      }),
    ).toBe('github.search');
  });

  it('never returns a raw JSON dump as the preview', () => {
    expect(
      resolveMcpHeaderPreview({
        displayName: 'MCP gateway',
        toolName: 'mcp_gateway',
        summary: '{"project":"piwin"}',
        inputPreview: '{"project":"piwin"}',
      }),
    ).toBe('');
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

describe('kindVerb', () => {
  it('does not leave a snake_case tool name as the fallback verb', () => {
    expect(kindVerb('unknown', 'custom_debugger')).toBe('custom debugger');
    expect(humanizeToolCallName('search_replace')).toBe('search replace');
    expect(kindVerb('filesystem', 'read_file')).toBe('Read');
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
