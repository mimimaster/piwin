import { describe, expect, it } from 'vitest';
import type { SessionCapabilitySnapshot } from '@piwin/contracts';
import {
  BLUEPRINT_PROTOCOL_VERSION,
  isSerializableBlueprint,
  projectBlueprintForWorker,
} from './serializable-blueprint.js';

function snapshot(overrides: Partial<SessionCapabilitySnapshot> = {}): SessionCapabilitySnapshot {
  return {
    version: 1,
    snapshotId: 'snap-1',
    inputs: {
      rulesRevision: 'rules-1',
      settingsRevision: 'r1',
      projectRevision: 'r2',
      mcpRevision: 'r3',
      resourceCatalogRevision: 'r4',
    },
    scope: { kind: 'general' },
    workingDirectory: '/tmp/work',
    trust: { kind: 'general' },
    resources: {
      skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
    },
    resourceManifest: {
      skills: [
        { resourceId: 's1', kind: 'skill', name: 'S1', path: '/a/s1', source: 'user' },
        { resourceId: 's2', kind: 'skill', name: 'S2', path: '/a/s2', source: 'mapped' },
      ],
      extensions: [
        { resourceId: 'e1', kind: 'extension', name: 'E1', path: '/a/e1', source: 'user' },
      ],
      prompts: [],
      diagnostics: [],
    },
    context: {
      allowPiNativeInstructions: true,
      allowProjectAgentsFiles: true,
      allowProjectSystemPrompts: true,
    },
    contextManifest: {
      agentsFiles: [{ kind: 'agents', source: 'project', absolutePath: '/p/AGENTS.md' }],
    },
    tools: {
      enabledFamilies: ['web-search'],
      piBuiltinToolNames: ['read'],
      hostTools: [{ name: 'web_search', description: 'Search the web', parameters: {} }],
      enabledMcpServerIds: [],
    },
    ...overrides,
  };
}

describe('projectBlueprintForWorker', () => {
  it('projects a general snapshot into a JSON-safe frame with protocol version', () => {
    const blueprint = projectBlueprintForWorker(snapshot());
    expect(blueprint.protocolVersion).toBe(BLUEPRINT_PROTOCOL_VERSION);
    expect(blueprint.snapshotId).toBe('snap-1');
    expect(blueprint.settingsRevision).toBe('r1');
    expect(blueprint.workingDirectory).toBe('/tmp/work');
    expect(blueprint.scope).toEqual({ kind: 'general' });
    expect(blueprint.tools.hostTools.map((tool) => tool.name)).toEqual(['web_search']);
    expect(blueprint.activeSkillPaths).toEqual(['/a/s1', '/a/s2']);
    expect(blueprint.activeExtensionPaths).toEqual(['/a/e1']);
    expect(blueprint.activePromptPaths).toEqual([]);
  });

  it('derives active path lists only from the active resource manifest', () => {
    const blueprint = projectBlueprintForWorker(
      snapshot({
        resourceManifest: {
          skills: [],
          extensions: [],
          prompts: [],
          diagnostics: [],
        },
      }),
    );
    expect(blueprint.activeSkillPaths).toEqual([]);
    expect(blueprint.activeExtensionPaths).toEqual([]);
    expect(blueprint.activePromptPaths).toEqual([]);
  });

  it('projects a trusted project snapshot with its path', () => {
    const blueprint = projectBlueprintForWorker(
      snapshot({
        trust: { kind: 'project', projectPath: '/p', trusted: true },
      }),
    );
    expect(blueprint.scope).toEqual({ kind: 'project', projectPath: '/p', trusted: true });
  });

  it('projects the subagent ceiling capabilities and skill ids', () => {
    const blueprint = projectBlueprintForWorker(
      snapshot({
        subagentCeiling: {
          allowedCapabilities: ['read', 'network'],
          allowedSkillIds: ['review'],
          workingDirectory: '/tmp/work',
          isolation: 'readonly',
        },
      }),
    );
    expect(blueprint.subagentCeiling).toEqual({
      allowedCapabilities: ['read', 'network'],
      allowedSkillIds: ['review'],
      isolation: 'readonly',
    });
  });

  it('includes optional model and thinking level', () => {
    const blueprint = projectBlueprintForWorker(snapshot(), {
      model: { providerId: 'p', modelId: 'm' },
      thinkingLevel: 'high',
    });
    expect(blueprint.model).toEqual({ providerId: 'p', modelId: 'm' });
    expect(blueprint.thinkingLevel).toBe('high');
  });

  it('survives JSON round-trip (golden protocol fixture)', () => {
    const blueprint = projectBlueprintForWorker(snapshot());
    const json = JSON.stringify(blueprint);
    const roundTripped = JSON.parse(json) as unknown;
    expect(isSerializableBlueprint(roundTripped)).toBe(true);
    expect(roundTripped).toEqual(blueprint);
  });

  it('rejects malformed frames at the protocol boundary', () => {
    expect(isSerializableBlueprint(null)).toBe(false);
    expect(isSerializableBlueprint({ snapshotId: 123 })).toBe(false);
    expect(
      isSerializableBlueprint({
        snapshotId: 'x',
        workingDirectory: '/w',
        protocolVersion: 2,
        activeSkillPaths: [],
        activeExtensionPaths: [],
        activePromptPaths: [],
        scope: { kind: 'general' },
      }),
    ).toBe(false);
    expect(
      isSerializableBlueprint({
        snapshotId: 'x',
        workingDirectory: '/w',
        protocolVersion: BLUEPRINT_PROTOCOL_VERSION,
        activeSkillPaths: [],
        activeExtensionPaths: [],
        activePromptPaths: [],
        scope: { kind: 'bogus' },
      }),
    ).toBe(false);
  });
});
