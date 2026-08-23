import { describe, expect, it } from 'vitest';
import {
  looksLikeArgsDumpSummary,
  recoverSummaryFromInputPreview,
  resolveMcpHeaderPreview,
  resolveToolCallHeaderPreview,
} from './tool-call-head';

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

  it('keeps MCP identity preview while expanded (body owns JSON args, not the name)', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'github / search · piwin',
        displayName: 'github / search',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: true,
        hasDetailInBody: true,
        keepTitlePreview: true,
      }),
    ).toBe('github / search · piwin');
  });

  it('keeps MCP identity preview when it repeats the title (verb is generic 已调用)', () => {
    expect(
      resolveToolCallHeaderPreview({
        summary: 'agent-memory / agent_memory_get_context',
        displayName: 'agent-memory / agent_memory_get_context',
        showFilePill: false,
        pillLabel: '',
        singleBasename: '',
        isPathLike: false,
        expanded: false,
        hasDetailInBody: true,
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
