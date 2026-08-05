import { describe, expect, it } from 'vitest';
import type { BackendSessionBlueprint } from './backend-session-blueprint.js';

function createBlueprint(): BackendSessionBlueprint {
  return {
    version: 1,
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    capabilitySnapshot: {
      version: 1,
      snapshotId: 'snapshot-1',
      inputs: {
        rulesRevision: 'rules-1',
        settingsRevision: 'settings-1',
        projectRevision: 'project-1',
        mcpRevision: 'mcp-1',
        resourceCatalogRevision: 'resources-1',
      },
      scope: { kind: 'general' },
      workingDirectory: '/tmp/piwin',
      trust: { kind: 'general' },
      resources: {
        skills: { disabledIds: [], allowedSources: ['bundled'], allowlistedIds: null },
        extensions: { disabledIds: [], allowedSources: ['bundled'], allowlistedIds: null },
        prompts: { disabledIds: [], allowedSources: ['bundled'], allowlistedIds: null },
      },
      resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
      context: {
        allowPiNativeInstructions: true,
        allowProjectAgentsFiles: false,
        allowProjectSystemPrompts: false,
      },
      contextManifest: { agentsFiles: [] },
      tools: {
        hostTools: [],
        piBuiltinToolNames: [],
        enabledMcpServerIds: [],
        enabledFamilies: [],
      },
    },
    model: {
      protocol: 'openai-compatible',
      providerId: 'provider-1',
      modelId: 'model-1',
    },
    thinkingLevel: 'high',
  };
}

describe('BackendSessionBlueprint', () => {
  it('survives a JSON round-trip without loss', () => {
    const blueprint = createBlueprint();
    const roundTripped = JSON.parse(JSON.stringify(blueprint)) as unknown;

    expect(roundTripped).toEqual(blueprint);
  });

  it('preserves exact empty tool arrays', () => {
    const blueprint = createBlueprint();

    expect(blueprint.capabilitySnapshot.tools.hostTools).toEqual([]);
    expect(blueprint.capabilitySnapshot.tools.piBuiltinToolNames).toEqual([]);
    expect(blueprint.capabilitySnapshot.tools.enabledMcpServerIds).toEqual([]);
    expect(blueprint.capabilitySnapshot.tools.enabledFamilies).toEqual([]);
  });
});
