import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_EXPLICIT_ONLY_HINT,
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  createDefaultArtifactConfig,
  formatArtifactInstructions,
  formatArtifactKitReference,
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
  it('injects compact routing and fence syntax when enabled', () => {
    const artifactConfig = config();
    const prompt = formatArtifactCapabilityPrompt(artifactConfig);

    expect(prompt).toBe(formatArtifactInstructions(artifactConfig));
    expect(prompt).toContain('## Decision Criteria');
    expect(prompt).toContain('## HTML Artifact Runtime Contract');
    expect(prompt).toContain('proactively');
    expect(prompt?.length).toBeLessThanOrEqual(2000);
    expect(prompt).not.toContain('trend-up');
    expect(prompt).toContain('```artifact-html');
  });

  it('keeps a custom decision policy resident', () => {
    const prompt = formatArtifactCapabilityPrompt(
      config({ decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' } }),
    );

    expect(prompt).toContain('private custom sentinel');
    expect(prompt).toContain('## HTML Artifact Runtime Contract');
  });

  it('preserves explicit-only routing and disappears when disabled', () => {
    const explicit = formatArtifactCapabilityPrompt(config({ triggerMode: 'explicit-only' }));
    expect(explicit).toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    expect(explicit).toContain('## Decision Criteria');
    expect(explicit).toContain('## HTML Artifact Runtime Contract');
    expect(formatArtifactCapabilityPrompt(config({ enabled: false }))).toBeUndefined();
  });

  it('keeps explicit-only on the resident prompt in custom-prompt mode', () => {
    const prompt = formatArtifactCapabilityPrompt(
      config({
        triggerMode: 'explicit-only',
        decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' },
      }),
    );

    expect(prompt).toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    expect(prompt).toContain('private custom sentinel');
    expect(prompt).toContain('## HTML Artifact Runtime Contract');
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

describe('artifact_instructions reference loading', () => {
  const context = {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  };

  it('returns authoring guidance without repeating the resident policy or fence protocol', async () => {
    const tool = buildArtifactInstructionsTool();
    const result = await tool.execute({}, new AbortController().signal, context);

    expect(tool.family).toBe('artifact');
    expect(tool.permissionSpec.readOnly).toBe(true);
    expect(tool.descriptor.description.length).toBeLessThan(160);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.output).toBe(formatArtifactKitReference());
    expect(result.output).not.toContain('## Decision Criteria');
    expect(result.output).not.toContain('## HTML Artifact Runtime Contract');
    expect(result.output).not.toContain('```artifact-html');
    expect(result.output).toContain('### Rendering reference');
    expect(result.output).toContain('### Report Kit');
    expect(result.output).toContain('trend-up');
    expect(result.output).toContain('piwin.chart(');
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(result.output).not.toContain(alias);
    }
  });

  it('keeps configured constraints resident without repeating them in the reference', async () => {
    const artifactConfig = config({
      triggerMode: 'explicit-only',
      decisionPrompt: { mode: 'custom', customPrompt: 'private custom sentinel' },
    });
    const resident = formatArtifactCapabilityPrompt(artifactConfig);
    expect(resident).toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    expect(resident).toContain('private custom sentinel');
    expect(resident).toContain(formatArtifactProtocol());

    const result = await buildArtifactInstructionsTool().execute({}, new AbortController().signal, context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.output).not.toContain('private custom sentinel');
    expect(result.output).not.toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    for (const marker of SOURCE_OR_UI_STATE_MARKERS) {
      expect(result.output).not.toContain(marker);
    }
    expect(result.output).not.toContain('session-1');
  });

  it('returns the reference only once for concurrent calls in the same run', async () => {
    const tool = buildArtifactInstructionsTool();
    const signal = new AbortController().signal;
    const [first, repeated] = await Promise.all([
      tool.execute({}, signal, { ...context, toolCallId: 'call-1' }),
      tool.execute({}, signal, { ...context, toolCallId: 'call-2' }),
    ]);

    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    if (!first.ok || !repeated.ok) throw new Error('expected successful Artifact reference results');
    expect(first.output).toBe(formatArtifactKitReference());
    expect(repeated.output).not.toContain('[piwin-artifact-kit');
    expect(repeated.output).toContain('already loaded for this run');
    expect(repeated.output.length).toBeLessThan(200);
  });

  it('loads the reference again for another run, generation or session', async () => {
    const tool = buildArtifactInstructionsTool();
    const signal = new AbortController().signal;
    for (const nextContext of [
      context,
      { ...context, runId: 'run-2' },
      { ...context, runtimeGenerationId: 'generation-2' },
      { ...context, sessionId: 'session-2' },
    ]) {
      const result = await tool.execute({}, signal, nextContext);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.output).toBe(formatArtifactKitReference());
    }
  });
});
