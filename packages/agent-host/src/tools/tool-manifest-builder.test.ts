import { describe, expect, it } from 'vitest';
import type { SubagentCapability } from '@piwin/contracts';
import {
  buildToolManifest,
  type CandidateToolSet,
  type ToolManifestInput,
} from './tool-manifest-builder.js';

const candidate: CandidateToolSet = {
  customToolNames: [
    'web_search',
    'web_fetch',
    'mcp_gateway',
    'process_start',
    'process_list',
    'browser_navigate',
    'note_read',
    'note_write',
    'flashcard_create',
    'piwin_plan_create',
    'piwin_subagent_run',
  ],
  piBuiltinToolNames: ['read', 'grep', 'bash', 'write'],
  enabledMcpServerIds: ['s1'],
};

function input(overrides: Partial<ToolManifestInput> = {}): ToolManifestInput {
  return {
    candidate,
    policy: {
      customToolNames: [...candidate.customToolNames],
      piBuiltinToolNames: [...candidate.piBuiltinToolNames],
      enabledMcpServerIds: ['s1'],
    },
    ...overrides,
  };
}

describe('buildToolManifest', () => {
  it('global session keeps only policy-enabled candidate tools', () => {
    const manifest = buildToolManifest(
      input({
        policy: {
          customToolNames: ['web_search'],
          piBuiltinToolNames: ['read'],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(manifest.customToolNames).toEqual(['web_search']);
    expect(manifest.piBuiltinToolNames).toEqual(['read']);
    expect(manifest.enabledMcpServerIds).toEqual([]);
  });

  it('candidate names not in policy are removed', () => {
    const manifest = buildToolManifest(
      input({
        policy: {
          customToolNames: [],
          piBuiltinToolNames: [],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(manifest.customToolNames).toEqual([]);
    expect(manifest.piBuiltinToolNames).toEqual([]);
  });

  it('empty subagent capability array means NO tools (exact empty allowlist)', () => {
    const manifest = buildToolManifest(input({ subagentCapabilities: [] }));
    expect(manifest.customToolNames).toEqual([]);
    expect(manifest.piBuiltinToolNames).toEqual([]);
  });

  it('read-only child gets only read capabilities', () => {
    const manifest = buildToolManifest(input({ subagentCapabilities: ['read'] }));
    expect(manifest.piBuiltinToolNames).toEqual(['grep', 'read']);
    expect(manifest.customToolNames).toEqual([]);
  });

  it('network-only child gets web tools only', () => {
    const manifest = buildToolManifest(input({ subagentCapabilities: ['network'] }));
    expect(manifest.customToolNames).toEqual(['web_fetch', 'web_search']);
    expect(manifest.piBuiltinToolNames).toEqual([]);
  });

  it('read + network child intersects both ceilings', () => {
    const manifest = buildToolManifest(input({ subagentCapabilities: ['read', 'network'] }));
    expect(manifest.customToolNames).toEqual(['web_fetch', 'web_search']);
    expect(manifest.piBuiltinToolNames).toEqual(['grep', 'read']);
  });

  it('global disable intersects the child ceiling', () => {
    const manifest = buildToolManifest(
      input({
        subagentCapabilities: ['network'],
        policy: {
          customToolNames: [], // web globally disabled
          piBuiltinToolNames: [],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(manifest.customToolNames).toEqual([]);
  });

  it('a new globally added tool never expands an existing child ceiling', () => {
    const childCeiling = buildToolManifest(
      input({
        subagentCapabilities: ['network'],
        policy: {
          customToolNames: ['web_search', 'web_fetch', 'brand_new_tool'],
          piBuiltinToolNames: [],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(childCeiling.customToolNames).not.toContain('brand_new_tool');
  });
});
