import { describe, expect, it } from 'vitest';
import type {
  ContextPolicy,
  ResourcePolicy,
  SessionToolPolicy,
  SubagentCapabilityCeiling,
} from '@piwin/contracts';
import {
  compileSessionCapabilitySnapshot,
  computeSnapshotId,
  type CompileSnapshotInput,
} from './session-capability-resolver.js';

const emptyResourcePolicy: ResourcePolicy = {
  skills: { disabledIds: [], allowedSources: ['bundled', 'user', 'mapped'], allowlistedIds: null },
  extensions: {
    disabledIds: [],
    allowedSources: ['bundled', 'user', 'mapped'],
    allowlistedIds: null,
  },
  prompts: { disabledIds: [], allowedSources: ['bundled', 'user', 'mapped'], allowlistedIds: null },
};

const contextPolicy: ContextPolicy = {
  allowPiNativeInstructions: true,
  allowProjectAgentsFiles: true,
  allowProjectSystemPrompts: true,
};

const toolPolicy: SessionToolPolicy = {
  hostTools: [{ name: 'web_search', description: 'Search the web', parameters: {} }],
  enabledFamilies: ['web-search'],
  piBuiltinToolNames: [],
  enabledMcpServerIds: [],
};

const ceiling: SubagentCapabilityCeiling = {
  allowedCapabilities: ['read', 'network'],
  allowedSkillIds: [],
  workingDirectory: '/tmp/work',
  isolation: 'readonly',
};

function input(overrides: Partial<CompileSnapshotInput> = {}): CompileSnapshotInput {
  return {
    inputs: {
      settingsRevision: 'r1',
      projectRevision: 'r2',
      mcpRevision: 'r3',
      resourceCatalogRevision: 'r4',
    },
    scope: { kind: 'general' },
    workingDirectory: 'general',
    trust: { kind: 'general' },
    resources: emptyResourcePolicy,
    resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
    context: contextPolicy,
    contextManifest: { agentsFiles: [] },
    tools: toolPolicy,
    ...overrides,
  };
}

describe('compileSessionCapabilitySnapshot', () => {
  it('compiles a versioned snapshot with all inputs and a stable id', () => {
    const snapshot = compileSessionCapabilitySnapshot(input());
    expect(snapshot.version).toBe(1);
    expect(snapshot.snapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.tools.hostTools.map((tool) => tool.name)).toEqual(['web_search']);
    expect(snapshot.trust).toEqual({ kind: 'general' });
  });

  it('revision inputs do not affect the snapshot id', () => {
    const base = compileSessionCapabilitySnapshot(input());
    const differentRevisions = compileSessionCapabilitySnapshot(
      input({
        inputs: {
          settingsRevision: 'x',
          projectRevision: 'y',
          mcpRevision: 'z',
          resourceCatalogRevision: 'w',
        },
      }),
    );
    expect(differentRevisions.snapshotId).toBe(base.snapshotId);
  });

  it('a different tool policy changes the snapshot id', () => {
    const base = compileSessionCapabilitySnapshot(input());
    const changed = compileSessionCapabilitySnapshot(
      input({ tools: { ...toolPolicy, hostTools: [] } }),
    );
    expect(changed.snapshotId).not.toBe(base.snapshotId);
  });

  it('records the subagent ceiling when present', () => {
    const snapshot = compileSessionCapabilitySnapshot(input({ subagentCeiling: ceiling }));
    expect(snapshot.subagentCeiling?.allowedCapabilities).toEqual(['read', 'network']);
  });

  it('omits the subagent ceiling when absent', () => {
    const snapshot = compileSessionCapabilitySnapshot(input());
    expect(snapshot.subagentCeiling).toBeUndefined();
  });

  it('computeSnapshotId is stable across identical inputs', () => {
    expect(computeSnapshotId(input())).toBe(computeSnapshotId(input()));
  });
});
