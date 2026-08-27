import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_EXPLICIT_ONLY_HINT,
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  createDefaultArtifactConfig,
  formatArtifactInstructions,
  formatArtifactProtocol,
  type ArtifactConfig,
} from '@piwin/contracts';
import {
  buildArtifactInstructionsTool,
  formatArtifactCapabilityPrompt,
  formatResidentArtifactPrompt,
} from './artifact-instructions-tool.js';

function config(overrides: Partial<ArtifactConfig> = {}): ArtifactConfig {
  return { ...createDefaultArtifactConfig(), ...overrides };
}

const PARSER_ONLY_ALIASES = ['artifact_html', 'ui-html', 'ui_html', 'html-artifact'] as const;
const SOURCE_OR_UI_STATE_MARKERS = [
  'srcdoc',
  'channelId',
  'enabled: true',
  'maxBytes',
  'artifactHtml',
  'sessionId',
  'runtimeGenerationId',
] as const;

describe('Artifact instruction loading', () => {
  it('keeps the resident capability hint compact and loads instructions once per run', () => {
    const artifactConfig = config();
    const prompt = formatArtifactCapabilityPrompt(artifactConfig);

    expect(prompt).toContain('<artifact_policy>');
    expect(prompt).toContain('</artifact_policy>');
    expect(prompt).toContain(ARTIFACT_INSTRUCTIONS_TOOL_NAME);
    expect(prompt).toContain('invoke `artifact_instructions` once');
    expect(prompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(prompt).not.toContain('## Artifact Decision Policy');
    expect(prompt?.length).toBeLessThan(600);
    expect(prompt?.length).toBeLessThan(formatArtifactInstructions(artifactConfig).length);
  });

  it('does not keep a custom decision policy resident', () => {
    const prompt = formatArtifactCapabilityPrompt(
      config({ decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' } }),
    );

    expect(prompt).toContain('<artifact_policy>');
    expect(prompt).toContain('A custom Artifact decision policy is configured');
    expect(prompt).not.toContain('private custom sentinel');
    expect(prompt).toContain('invoke `artifact_instructions` once');
  });

  it('preserves explicit-only routing and disappears when disabled', () => {
    expect(formatArtifactCapabilityPrompt(config({ triggerMode: 'explicit-only' }))).toContain(
      ARTIFACT_EXPLICIT_ONLY_HINT,
    );
    expect(formatArtifactCapabilityPrompt(config({ enabled: false }))).toBeUndefined();
  });

  it('keeps explicit-only on the resident hint in custom-prompt mode', () => {
    const prompt = formatArtifactCapabilityPrompt(
      config({
        triggerMode: 'explicit-only',
        decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' },
      }),
    );

    expect(prompt).toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    expect(prompt).toContain('A custom Artifact decision policy is configured');
    expect(prompt).not.toContain('private custom sentinel');
  });

  it('stays off the resident prompt unless a concrete executor is present', () => {
    const artifactConfig = config();
    expect(formatResidentArtifactPrompt(artifactConfig, [])).toBeUndefined();
    expect(
      formatResidentArtifactPrompt(artifactConfig, [
        {
          name: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
          description: 'Artifact instructions',
          parameters: {},
        },
      ]),
    ).toBe(formatArtifactCapabilityPrompt(artifactConfig));
  });
});

describe('artifact_instructions golden', () => {
  it('returns rules only from the shared protocol formatter', async () => {
    const artifactConfig = config();
    const tool = buildArtifactInstructionsTool(artifactConfig);
    const result = await tool.execute({}, new AbortController().signal, {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolName: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
    });

    expect(tool.family).toBe('artifact');
    expect(tool.permissionSpec.readOnly).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.output).toBe(formatArtifactInstructions(artifactConfig));
    expect(result.output).toContain(formatArtifactProtocol());
    expect(result.output).toContain('## Decision Criteria');
    expect(result.output).toContain('## HTML Artifact Runtime Contract');
    expect(result.output).toContain('```artifact-html');
    expect(result.output.split('## HTML Artifact Runtime Contract')).toHaveLength(2);
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(result.output).not.toContain(alias);
    }
  });

  it('does not carry Artifact source or UI state', async () => {
    const tool = buildArtifactInstructionsTool(
      config({ decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' } }),
    );
    const result = await tool.execute({}, new AbortController().signal, {
      sessionId: 'session-secret',
      runtimeGenerationId: 'generation-secret',
      runId: 'run-secret',
      toolName: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.output).toContain('private custom sentinel');
    expect(result.output).toContain(formatArtifactProtocol());
    for (const marker of SOURCE_OR_UI_STATE_MARKERS) {
      expect(result.output).not.toContain(marker);
    }
    expect(result.output).not.toContain('session-secret');
    expect(result.output).not.toContain('<div');
    expect(result.output).not.toContain('artifactHtml');
  });

  it('returns the full contract only once for the same run', async () => {
    const tool = buildArtifactInstructionsTool(config());
    const context = {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
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
    expect(first.output).toBe(formatArtifactInstructions(config()));
    expect(repeated.output).not.toContain('## HTML Artifact Runtime Contract');
    expect(repeated.output).toContain('already loaded for this run');
    expect(repeated.output.length).toBeLessThan(200);
  });

  it('includes the explicit-only constraint in tool output, including custom mode', async () => {
    const artifactConfig = config({
      triggerMode: 'explicit-only',
      decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' },
    });
    const tool = buildArtifactInstructionsTool(artifactConfig);
    const result = await tool.execute({}, new AbortController().signal, {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolName: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.output).toBe(formatArtifactInstructions(artifactConfig));
    expect(result.output).toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    expect(result.output).toContain('private custom sentinel');
    expect(result.output).toContain(formatArtifactProtocol());
  });

  it('loads the full contract again for another run or runtime generation', async () => {
    const tool = buildArtifactInstructionsTool(config());
    const signal = new AbortController().signal;
    const baseContext = {
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      runId: 'run-1',
      toolName: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
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
      expect(result.output).toBe(formatArtifactInstructions(config()));
    }
  });
});
