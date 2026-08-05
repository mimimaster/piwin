import { describe, expect, it } from 'vitest';
import {
  buildSessionToolPolicy,
  type CandidateToolSet,
  type SessionToolPolicyInput,
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

function input(overrides: Partial<SessionToolPolicyInput> = {}): SessionToolPolicyInput {
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

describe('buildSessionToolPolicy', () => {
  it('global session keeps only policy-enabled candidate pi built-ins', () => {
    const manifest = buildSessionToolPolicy(
      input({
        policy: {
          customToolNames: ['web_search'],
          piBuiltinToolNames: ['read'],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(manifest.piBuiltinToolNames).toEqual(['read']);
    expect(manifest.enabledMcpServerIds).toEqual([]);
  });

  it('candidate names not in policy are removed', () => {
    const manifest = buildSessionToolPolicy(
      input({
        policy: {
          customToolNames: [],
          piBuiltinToolNames: [],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(manifest.hostTools).toEqual([]);
    expect(manifest.piBuiltinToolNames).toEqual([]);
  });

  it('empty subagent capability array means NO tools (exact empty allowlist)', () => {
    const manifest = buildSessionToolPolicy(input({ subagentCapabilities: [] }));
    expect(manifest.hostTools).toEqual([]);
    expect(manifest.piBuiltinToolNames).toEqual([]);
  });

  it('read-only child gets only read capabilities', () => {
    const manifest = buildSessionToolPolicy(input({ subagentCapabilities: ['read'] }));
    expect(manifest.piBuiltinToolNames).toEqual(['grep', 'read']);
    expect(manifest.hostTools).toEqual([]);
  });

  it('network-only child gets web tools only', () => {
    const manifest = buildSessionToolPolicy(input({ subagentCapabilities: ['network'] }));
    expect(manifest.piBuiltinToolNames).toEqual([]);
  });

  it('read + network child intersects both ceilings', () => {
    const manifest = buildSessionToolPolicy(input({ subagentCapabilities: ['read', 'network'] }));
    expect(manifest.piBuiltinToolNames).toEqual(['grep', 'read']);
  });

  it('global disable intersects the child ceiling', () => {
    const manifest = buildSessionToolPolicy(
      input({
        subagentCapabilities: ['network'],
        policy: {
          customToolNames: [],
          piBuiltinToolNames: [],
          enabledMcpServerIds: [],
        },
      }),
    );
    expect(manifest.hostTools).toEqual([]);
  });

  it('hostTools is always empty — descriptors come from buildSessionHostTools', () => {
    const manifest = buildSessionToolPolicy(input());
    expect(manifest.hostTools).toEqual([]);
  });
});
