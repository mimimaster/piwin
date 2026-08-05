import { describe, expect, it } from 'vitest';
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
  it('disabled family is absent from enabled families', () => {
    const policy = resolveToolPolicy(baseExposure({ process: 'off', browser: 'off' }));
    expect(policy.enabledFamilies).not.toContain('process');
    expect(policy.enabledFamilies).not.toContain('browser');
  });

  it('web search requires both master and a ready source', () => {
    expect(resolveToolPolicy(baseExposure({ webSearch: false })).enabledFamilies).not.toContain(
      'web-search',
    );
    const noSource = resolveToolPolicy(
      baseExposure({
        webSearch: true,
        availability: { ...baseExposure().availability, webSearchReady: false },
      }),
    );
    expect(noSource.enabledFamilies).not.toContain('web-search');
    const ready = resolveToolPolicy(baseExposure({ webSearch: true }));
    expect(ready.enabledFamilies).toContain('web-search');
  });

  it('web fetch is independent of web search', () => {
    const fetchOnly = resolveToolPolicy(baseExposure({ webFetch: true }));
    expect(fetchOnly.enabledFamilies).toContain('web-fetch');
    expect(fetchOnly.enabledFamilies).not.toContain('web-search');
    const noProvider = resolveToolPolicy(
      baseExposure({
        webFetch: true,
        availability: { ...baseExposure().availability, webFetchReady: false },
      }),
    );
    expect(noProvider.enabledFamilies).not.toContain('web-fetch');
  });

  it('MCP requires master and at least one enabled server', () => {
    const noServer = resolveToolPolicy(baseExposure({ mcp: true }));
    expect(noServer.enabledFamilies).not.toContain('mcp');
    const withServer = resolveToolPolicy(
      baseExposure({
        mcp: true,
        availability: { ...baseExposure().availability, mcpEnabledServerIds: ['s1'] },
      }),
    );
    expect(withServer.enabledFamilies).toContain('mcp');
    expect(withServer.enabledMcpServerIds).toEqual(['s1']);
  });

  it('process manual-only does not register agent tools', () => {
    const manual = resolveToolPolicy(baseExposure({ process: 'manual-only' }));
    expect(manual.enabledFamilies).not.toContain('process');
    const agent = resolveToolPolicy(baseExposure({ process: 'agent' }));
    expect(agent.enabledFamilies).toContain('process');
  });

  it('browser agent requires backend availability', () => {
    const noBackend = resolveToolPolicy(
      baseExposure({
        browser: 'agent',
        availability: { ...baseExposure().availability, browserReady: false },
      }),
    );
    expect(noBackend.enabledFamilies).not.toContain('browser');
    const agent = resolveToolPolicy(baseExposure({ browser: 'agent' }));
    expect(agent.enabledFamilies).toContain('browser');
  });

  it('notes read/write access matrix', () => {
    const off = resolveToolPolicy(baseExposure({ notes: 'off' }));
    expect(off.enabledFamilies).not.toContain('notes-read');
    expect(off.enabledFamilies).not.toContain('notes-write');

    const read = resolveToolPolicy(baseExposure({ notes: 'agent-read' }));
    expect(read.enabledFamilies).toContain('notes-read');
    expect(read.enabledFamilies).not.toContain('notes-write');

    const readWrite = resolveToolPolicy(baseExposure({ notes: 'agent-read-write' }));
    expect(readWrite.enabledFamilies).toContain('notes-read');
    expect(readWrite.enabledFamilies).toContain('notes-write');
  });

  it('flashcard access matrix', () => {
    const off = resolveToolPolicy(baseExposure({ flashcards: 'off' }));
    expect(off.enabledFamilies).not.toContain('flashcards-write');

    const manual = resolveToolPolicy(baseExposure({ flashcards: 'manual-review' }));
    expect(manual.enabledFamilies).not.toContain('flashcards-write');

    const agent = resolveToolPolicy(baseExposure({ flashcards: 'agent-create' }));
    expect(agent.enabledFamilies).toContain('flashcards-write');
    expect(agent.enabledFamilies).toContain('flashcards-read');
  });

  it('image generation requires master and a valid model', () => {
    const noModel = resolveToolPolicy(
      baseExposure({
        imageGeneration: true,
        availability: { ...baseExposure().availability, imageGenerationReady: false },
      }),
    );
    expect(noModel.enabledFamilies).not.toContain('image-generation');
    const ready = resolveToolPolicy(baseExposure({ imageGeneration: true }));
    expect(ready.enabledFamilies).toContain('image-generation');
  });

  it('hostTools is always empty — descriptors come from buildSessionHostTools', () => {
    const policy = resolveToolPolicy(baseExposure({ webSearch: true, process: 'agent' }));
    expect(policy.hostTools).toEqual([]);
  });
});
