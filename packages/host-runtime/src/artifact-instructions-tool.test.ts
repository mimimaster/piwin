import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_RUNTIME_CONTRACT,
} from '@piwin/agent-host';
import {
  createDefaultArtifactConfig,
  resolveArtifactDecisionPrompt,
  type ArtifactConfig,
} from '@piwin/contracts';
import {
  buildArtifactInstructionsTool,
  formatArtifactCapabilityPrompt,
} from './artifact-instructions-tool.js';

function config(overrides: Partial<ArtifactConfig> = {}): ArtifactConfig {
  return { ...createDefaultArtifactConfig(), ...overrides };
}

describe('Artifact instruction loading', () => {
  it('keeps the resident capability hint compact and leaves the runtime contract lazy', () => {
    const artifactConfig = config();
    const prompt = formatArtifactCapabilityPrompt(artifactConfig);

    expect(prompt).toContain('## Artifact capability');
    expect(prompt).toContain('artifact_instructions');
    expect(prompt).toContain('at most once per run');
    expect(prompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(prompt?.length).toBeLessThan(600);
    expect(prompt?.length).toBeLessThan(
      resolveArtifactDecisionPrompt(artifactConfig).length + ARTIFACT_RUNTIME_CONTRACT.length,
    );
  });

  it('does not keep a custom decision policy resident', () => {
    const prompt = formatArtifactCapabilityPrompt(
      config({ decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' } }),
    );

    expect(prompt).toContain('A custom Artifact decision policy is configured');
    expect(prompt).not.toContain('private custom sentinel');
  });

  it('preserves explicit-only routing and disappears when disabled', () => {
    expect(formatArtifactCapabilityPrompt(config({ triggerMode: 'explicit-only' }))).toContain(
      'only when the user explicitly requests',
    );
    expect(formatArtifactCapabilityPrompt(config({ enabled: false }))).toBeUndefined();
  });

  it('returns the exact configured decision policy and runtime contract on demand', async () => {
    const artifactConfig = config({
      decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' },
    });
    const tool = buildArtifactInstructionsTool(artifactConfig);
    const result = await tool.execute({}, new AbortController().signal, {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolName: 'artifact_instructions',
    });

    expect(tool.family).toBe('artifact');
    expect(tool.permissionSpec.readOnly).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.output).toContain('private custom sentinel');
    expect(result.output).toContain('## HTML Artifact Runtime Contract');
  });

  it('returns the full contract only once for the same run', async () => {
    const tool = buildArtifactInstructionsTool(config());
    const context = {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'artifact_instructions',
    };

    const [first, repeated] = await Promise.all([
      tool.execute({}, new AbortController().signal, context),
      tool.execute({}, new AbortController().signal, { ...context, toolCallId: 'call-2' }),
    ]);

    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    if (!first.ok || !repeated.ok) {
      throw new Error('expected successful Artifact instruction results');
    }
    expect(first.output).toContain('## HTML Artifact Runtime Contract');
    expect(repeated.output).not.toContain('## HTML Artifact Runtime Contract');
    expect(repeated.output).toContain('already loaded for this run');
    expect(repeated.output.length).toBeLessThan(200);
  });

  it('loads the full contract again for another run or runtime generation', async () => {
    const tool = buildArtifactInstructionsTool(config());
    const signal = new AbortController().signal;
    const baseContext = {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolName: 'artifact_instructions',
    };

    const firstRun = await tool.execute({}, signal, baseContext);
    const nextRun = await tool.execute({}, signal, { ...baseContext, runId: 'run-2' });
    const nextGeneration = await tool.execute({}, signal, {
      ...baseContext,
      runtimeGenerationId: 'generation-2',
    });

    for (const result of [firstRun, nextRun, nextGeneration]) {
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.message);
      }
      expect(result.output).toContain('## HTML Artifact Runtime Contract');
    }
  });
});
