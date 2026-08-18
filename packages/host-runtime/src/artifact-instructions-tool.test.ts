import { describe, expect, it } from 'vitest';
import {
  createDefaultArtifactConfig,
  type ArtifactConfig,
} from '@piwin/contracts';
import {
  formatArtifactCapabilityPrompt,
} from './artifact-instructions-tool.js';

function config(overrides: Partial<ArtifactConfig> = {}): ArtifactConfig {
  return { ...createDefaultArtifactConfig(), ...overrides };
}

describe('Artifact instruction prompt formatting', () => {
  it('directly injects the decision policy and runtime contract when enabled', () => {
    const artifactConfig = config();
    const prompt = formatArtifactCapabilityPrompt(artifactConfig);

    expect(prompt).toBeDefined();
    expect(prompt).toContain('[piwin-prompt-meta kind="artifact:capability"');
    expect(prompt).toContain('## Artifact Decision Policy');
    expect(prompt).toContain('## HTML Artifact Runtime Contract');
    expect(prompt).toContain('```artifact-html');
    expect(prompt).toContain('--piwin-artifact-');
  });

  it('injects a custom decision policy directly when configured', () => {
    const prompt = formatArtifactCapabilityPrompt(
      config({ decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' } }),
    );

    expect(prompt).toBeDefined();
    expect(prompt).toContain('private custom sentinel');
    expect(prompt).toContain('## HTML Artifact Runtime Contract');
  });

  it('preserves explicit-only routing and disappears when disabled', () => {
    expect(formatArtifactCapabilityPrompt(config({ triggerMode: 'explicit-only' }))).toContain(
      'only when the user explicitly requests',
    );
    expect(formatArtifactCapabilityPrompt(config({ enabled: false }))).toBeUndefined();
  });
});
