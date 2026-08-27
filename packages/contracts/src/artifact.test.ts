import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_EXPLICIT_ONLY_HINT,
  ARTIFACT_LANGUAGE_ALIASES,
  ARTIFACT_RUNTIME_CONTRACT,
  CANONICAL_ARTIFACT_LANGUAGE,
  DEFAULT_ARTIFACT_DECISION_PROMPT,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  createDefaultArtifactConfig,
  formatArtifactInstructions,
  formatArtifactProtocol,
  resolveArtifactDecisionPrompt,
  type ArtifactSurface,
} from './artifact.js';

const PARSER_ONLY_ALIASES = ['artifact_html', 'ui-html', 'ui_html', 'html-artifact'] as const;

describe('SVG artifact contract', () => {
  it('declares the standard svg fence language', () => {
    expect(NATIVE_SVG_ARTIFACT_LANGUAGES).toEqual(['svg']);
  });
});

describe('canonical artifact language', () => {
  it('locks model output to artifact-html and keeps aliases parser-input only', () => {
    expect(CANONICAL_ARTIFACT_LANGUAGE).toBe('artifact-html');
    expect(ARTIFACT_LANGUAGE_ALIASES[0]).toBe(CANONICAL_ARTIFACT_LANGUAGE);
    expect([...ARTIFACT_LANGUAGE_ALIASES]).toEqual([
      'artifact-html',
      'artifact_html',
      'ui-html',
      'ui_html',
      'html-artifact',
    ]);
  });

  it('types ArtifactSurface as the fence-declared render target', () => {
    const inline: ArtifactSurface = 'inline';
    const canvas: ArtifactSurface = 'canvas';
    expect(inline).toBe('inline');
    expect(canvas).toBe('canvas');
  });
});

describe('default artifact decision prompt', () => {
  it('wraps the proactive decision policy in a metadata block', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '[piwin-prompt-meta kind="artifact:decision" version="5" applies="artifacts-enabled"]',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '<artifact-decision-policy name="piwin-proactive-surfaces">',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('</artifact-decision-policy>');
  });

  it('treats dense reference content as a proactive artifact use case', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('information-dense content');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('command summaries');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('comparative tables');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'even without an explicit UI request',
    );
  });

  it('does not concatenate surface rules or parser-only aliases', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('## HTML Artifact Runtime Contract');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('```artifact-html');
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain(alias);
    }
  });

  it('routes short Markdown, dense Inline Artifact, and prototype Canvas', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'Short answers (1–2 paragraphs)',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '`artifact-html` without surface attr',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'Full app/page prototypes',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('```artifact-html');
  });
});

describe('artifact protocol formatter', () => {
  it('is the single surface-rule source and locks output to artifact-html', () => {
    const protocol = formatArtifactProtocol();
    expect(protocol).toBe(ARTIFACT_RUNTIME_CONTRACT);
    expect(protocol).toContain('## HTML Artifact Runtime Contract');
    expect(protocol).toContain('```artifact-html title="Short descriptive title"');
    expect(protocol).toContain('```artifact-html title="Short descriptive title" surface="canvas"');
    expect(protocol).toContain('surface="canvas"');
    expect(protocol).toContain('--piwin-artifact-');
    expect(protocol).toContain('kind="artifact:runtime" version="6"');
    expect(protocol).toContain('Canvas Viewport');
    expect(protocol).toContain('Emit complete `<style>` blocks before any visible HTML markup');
    expect(protocol).toContain(
      'Close each visual block before starting siblings',
    );
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(protocol).not.toContain(alias);
    }
  });

  it('assembles decision policy plus protocol without a second surface-rule copy', () => {
    const config = createDefaultArtifactConfig();
    const instructions = formatArtifactInstructions(config);
    expect(instructions).toBe(
      `${resolveArtifactDecisionPrompt(config)}\n\n${formatArtifactProtocol()}`,
    );
    expect(instructions).toContain('## Decision Criteria');
    expect(instructions).toContain('## HTML Artifact Runtime Contract');
    expect(instructions.split('## HTML Artifact Runtime Contract')).toHaveLength(2);
  });

  it('uses a custom decision policy when configured and still shares the protocol', () => {
    const config = createDefaultArtifactConfig();
    config.decisionPrompt = { mode: 'custom', customPrompt: 'private custom sentinel' };
    const instructions = formatArtifactInstructions(config);
    expect(instructions).toContain('private custom sentinel');
    expect(instructions).toContain(formatArtifactProtocol());
    expect(instructions).not.toContain('## Artifact Decision Policy');
    expect(instructions).not.toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
  });

  it('prefixes the explicit-only constraint onto default and custom decision prompts', () => {
    const defaultExplicit = createDefaultArtifactConfig();
    defaultExplicit.triggerMode = 'explicit-only';
    const defaultInstructions = formatArtifactInstructions(defaultExplicit);
    expect(defaultInstructions.startsWith(ARTIFACT_EXPLICIT_ONLY_HINT)).toBe(true);
    expect(defaultInstructions).toContain(resolveArtifactDecisionPrompt(defaultExplicit));
    expect(defaultInstructions).toContain(formatArtifactProtocol());

    const customExplicit = createDefaultArtifactConfig();
    customExplicit.triggerMode = 'explicit-only';
    customExplicit.decisionPrompt = { mode: 'custom', customPrompt: 'private custom sentinel' };
    const customInstructions = formatArtifactInstructions(customExplicit);
    expect(customInstructions).toContain(ARTIFACT_EXPLICIT_ONLY_HINT);
    expect(customInstructions).toContain('private custom sentinel');
    expect(customInstructions).toContain(formatArtifactProtocol());
    expect(customInstructions).toBe(
      `${ARTIFACT_EXPLICIT_ONLY_HINT}\n\nprivate custom sentinel\n\n${formatArtifactProtocol()}`,
    );
  });
});
