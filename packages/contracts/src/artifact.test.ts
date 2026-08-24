import { describe, expect, it } from 'vitest';
import {
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
      '[piwin-prompt-meta kind="artifact:decision" version="3" applies="artifacts-enabled"]',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '<artifact-decision-policy name="piwin-proactive-inline">',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('</artifact-decision-policy>');
  });

  it('treats dense reference content as a proactive artifact use case', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('information-dense response');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('command summary');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('long wall of text');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'prefer an Artifact even when the user does not explicitly mention UI',
    );
  });

  it('does not concatenate surface rules or parser-only aliases', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('## HTML Artifact Runtime Contract');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('```artifact-html');
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain(alias);
    }
  });
});

describe('artifact protocol formatter', () => {
  it('is the single surface-rule source and locks output to artifact-html', () => {
    const protocol = formatArtifactProtocol();
    expect(protocol).toBe(ARTIFACT_RUNTIME_CONTRACT);
    expect(protocol).toContain('## HTML Artifact Runtime Contract');
    expect(protocol).toContain('```artifact-html title="Short descriptive title"');
    expect(protocol).toContain('surface="canvas"');
    expect(protocol).toContain('--piwin-artifact-');
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
    expect(instructions).toContain('## Artifact Decision Policy');
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
  });
});
