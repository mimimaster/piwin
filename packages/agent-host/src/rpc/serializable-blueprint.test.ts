import { describe, expect, it } from 'vitest';
import type { SessionCapabilitySnapshot } from '@piwin/contracts';
import { isSerializableBlueprint, projectBlueprintForWorker } from './serializable-blueprint.js';

function snapshot(overrides: Partial<SessionCapabilitySnapshot> = {}): SessionCapabilitySnapshot {
  return {
    version: 1,
    snapshotId: 'snap-1',
    inputs: {
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
      skills: [{ resourceId: 's1', kind: 'skill', name: 'S1', path: '/a/s1', source: 'user' }],
      extensions: [],
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
      piBuiltinToolNames: [],
      customToolNames: ['web_search'],
      enabledMcpServerIds: [],
    },
    ...overrides,
  };
}

describe('projectBlueprintForWorker', () => {
  it('projects a general snapshot into a JSON-safe frame', () => {
    const blueprint = projectBlueprintForWorker(snapshot());
    expect(blueprint.snapshotId).toBe('snap-1');
    expect(blueprint.workingDirectory).toBe('/tmp/work');
    expect(blueprint.scope).toEqual({ kind: 'general' });
    expect(blueprint.tools.customToolNames).toEqual(['web_search']);
    expect(blueprint.resourceManifest.skills[0]?.resourceId).toBe('s1');
    expect(blueprint.contextManifest.agentsFiles).toHaveLength(1);
  });

  it('projects a trusted project snapshot with its path', () => {
    const blueprint = projectBlueprintForWorker(
      snapshot({
        trust: { kind: 'project', projectPath: '/p', trusted: true },
      }),
    );
    expect(blueprint.scope).toEqual({ kind: 'project', projectPath: '/p', trusted: true });
  });

  it('projects the subagent ceiling capabilities', () => {
    const blueprint = projectBlueprintForWorker(
      snapshot({
        subagentCeiling: {
          allowedCapabilities: ['read', 'network'],
          allowedSkillIds: [],
          workingDirectory: '/tmp/work',
          isolation: 'readonly',
        },
      }),
    );
    expect(blueprint.subagentCapabilities).toEqual(['read', 'network']);
  });

  it('includes optional model and thinking level', () => {
    const blueprint = projectBlueprintForWorker(snapshot(), {
      model: { providerId: 'p', modelId: 'm' },
      thinkingLevel: 'high',
    });
    expect(blueprint.model).toEqual({ providerId: 'p', modelId: 'm' });
    expect(blueprint.thinkingLevel).toBe('high');
  });

  it('survives JSON round-trip', () => {
    const blueprint = projectBlueprintForWorker(snapshot());
    const roundTripped = JSON.parse(JSON.stringify(blueprint)) as unknown;
    expect(isSerializableBlueprint(roundTripped)).toBe(true);
    expect(isSerializableBlueprint(blueprint)).toBe(true);
  });

  it('rejects malformed frames at the protocol boundary', () => {
    expect(isSerializableBlueprint(null)).toBe(false);
    expect(isSerializableBlueprint({ snapshotId: 123 })).toBe(false);
    expect(
      isSerializableBlueprint({
        snapshotId: 'x',
        workingDirectory: '/w',
        scope: { kind: 'bogus' },
      }),
    ).toBe(false);
  });
});
