import { describe, expect, it } from 'vitest';
import type { CapabilityExposure, FlashcardsAccess, NotesAccess } from '@piwin/contracts';
import { resolveToolPolicy, type ToolExposureInput } from './tool-policy-resolver.js';

function baseExposure(overrides: Partial<ToolExposureInput> = {}): ToolExposureInput {
  return {
    webSearch: false,
    webFetch: false,
    mcp: false,
    imageGeneration: false,
    process: 'off',
    browser: 'off',
    subagents: 'off',
    notes: 'off',
    flashcards: 'off',
    availability: {
      webSearchReady: true,
      webFetchReady: true,
      mcpEnabledServerIds: [],
      processReady: true,
      browserReady: true,
      imageGenerationReady: true,
    },
    ...overrides,
  };
}

describe('resolveToolPolicy', () => {
  it('disabled family is absent from tool names', () => {
    const policy = resolveToolPolicy(baseExposure({ process: 'off', browser: 'off' }));
    expect(policy.customToolNames).not.toContain('process_start');
    expect(policy.customToolNames).not.toContain('browser_navigate');
  });

  it('web search requires both master and a ready source', () => {
    expect(resolveToolPolicy(baseExposure({ webSearch: false })).customToolNames).not.toContain(
      'web_search',
    );
    const noSource = resolveToolPolicy(
      baseExposure({
        webSearch: true,
        availability: { ...baseExposure().availability, webSearchReady: false },
      }),
    );
    expect(noSource.customToolNames).not.toContain('web_search');
    const ready = resolveToolPolicy(baseExposure({ webSearch: true }));
    expect(ready.customToolNames).toContain('web_search');
  });

  it('web fetch is independent of web search', () => {
    const fetchOnly = resolveToolPolicy(baseExposure({ webFetch: true }));
    expect(fetchOnly.customToolNames).toContain('web_fetch');
    expect(fetchOnly.customToolNames).not.toContain('web_search');
    const noProvider = resolveToolPolicy(
      baseExposure({
        webFetch: true,
        availability: { ...baseExposure().availability, webFetchReady: false },
      }),
    );
    expect(noProvider.customToolNames).not.toContain('web_fetch');
  });

  it('MCP requires master and at least one enabled server', () => {
    const noServer = resolveToolPolicy(baseExposure({ mcp: true }));
    expect(noServer.customToolNames).not.toContain('mcp_gateway');
    const withServer = resolveToolPolicy(
      baseExposure({
        mcp: true,
        availability: { ...baseExposure().availability, mcpEnabledServerIds: ['s1'] },
      }),
    );
    expect(withServer.customToolNames).toContain('mcp_gateway');
    expect(withServer.enabledMcpServerIds).toEqual(['s1']);
  });

  it('process manual-only does not register agent tools', () => {
    const manual = resolveToolPolicy(baseExposure({ process: 'manual-only' }));
    expect(manual.customToolNames).not.toContain('process_start');
    const agent = resolveToolPolicy(baseExposure({ process: 'agent' }));
    expect(agent.customToolNames).toContain('process_start');
  });

  it('browser agent requires backend availability', () => {
    const noBackend = resolveToolPolicy(
      baseExposure({
        browser: 'agent',
        availability: { ...baseExposure().availability, browserReady: false },
      }),
    );
    expect(noBackend.customToolNames).not.toContain('browser_navigate');
    const agent = resolveToolPolicy(baseExposure({ browser: 'agent' }));
    expect(agent.customToolNames).toContain('browser_navigate');
  });

  it('notes read/write access matrix', () => {
    const off = resolveToolPolicy(baseExposure({ notes: 'off' }));
    expect(off.customToolNames).not.toContain('note_read');
    expect(off.customToolNames).not.toContain('note_write');

    const read = resolveToolPolicy(baseExposure({ notes: 'agent-read' }));
    expect(read.customToolNames).toContain('note_read');
    expect(read.customToolNames).not.toContain('note_write');

    const readWrite = resolveToolPolicy(baseExposure({ notes: 'agent-read-write' }));
    expect(readWrite.customToolNames).toContain('note_read');
    expect(readWrite.customToolNames).toContain('note_write');
  });

  it('flashcard access matrix', () => {
    const off = resolveToolPolicy(baseExposure({ flashcards: 'off' }));
    expect(off.customToolNames).not.toContain('flashcard_create');

    const manual = resolveToolPolicy(baseExposure({ flashcards: 'manual-review' }));
    expect(manual.customToolNames).not.toContain('flashcard_create');

    const agent = resolveToolPolicy(baseExposure({ flashcards: 'agent-create' }));
    expect(agent.customToolNames).toContain('flashcard_create');
    expect(agent.customToolNames).toContain('flashcard_list');
  });

  it('image generation requires master and a valid model', () => {
    const noModel = resolveToolPolicy(
      baseExposure({
        imageGeneration: true,
        availability: { ...baseExposure().availability, imageGenerationReady: false },
      }),
    );
    expect(noModel.customToolNames).not.toContain('image_gen');
    const ready = resolveToolPolicy(baseExposure({ imageGeneration: true }));
    expect(ready.customToolNames).toContain('image_gen');
  });
});
