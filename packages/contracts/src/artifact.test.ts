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
      '[piwin-prompt-meta kind="artifact:decision" version="8" applies="artifacts-enabled"]',
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
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Standalone reports');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('architecture reviews');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('MUST use Canvas');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('user intent');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Markdown table');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('```artifact-html');
  });

  it('keeps pre-slim proactive routing: scan/reuse, wall-of-text, default Inline, auto Canvas', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'scan, understand, search, copy, compare, and reuse',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('wall of text');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Default Artifact surface');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'opens the right workspace automatically',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('explain, debug, teach');
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
    expect(protocol).toContain('kind="artifact:runtime" version="12"');
    expect(protocol).toContain('On a light host never produce a dark-mode design');
    expect(protocol).toContain('data-piwin-media');
    expect(protocol).toContain('Never `data:image`');
    expect(protocol).toContain('Canvas Viewport');
    expect(protocol).toContain('Emit complete `<style>` blocks before any visible HTML markup');
    expect(protocol).toContain(
      'Close each visual block before starting siblings',
    );
    expect(protocol).toContain('### Success');
    expect(protocol).toContain('chat column sandbox');
    expect(protocol).toContain('Constraints (break without these)');
    expect(protocol).toContain('not a full-page landing');
    expect(protocol).toContain('nested vertical scroll');
    expect(protocol).toContain('never add horizontal scrolling to Inline');
    expect(protocol).not.toContain('Let table data wrap');
    expect(protocol).not.toContain('avoid nowrap on data cells');
    expect(protocol).toContain('overflow-wrap: break-word');
    expect(protocol).toContain('Never `word-break: break-word`');
    expect(protocol).toContain('keep label min-content');
    expect(protocol).toContain('Outermost wrapper background');
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(protocol).not.toContain(alias);
    }
  });

  it('shows block fences on their own line, not one-line empty fences', () => {
    const protocol = formatArtifactProtocol();
    expect(protocol).toContain('column 0 of its own line');
    expect(protocol).toContain('do not wrap attributes onto the next line');
    expect(protocol).toContain('Never append the opening fence to a sentence');
    expect(protocol).toContain('```artifact-html title="Short descriptive title"\n');
    expect(protocol).toContain(
      '```artifact-html title="Short descriptive title" surface="canvas"\n',
    );
    expect(protocol).toContain('```svg title="Short descriptive title"\n');
    expect(protocol).not.toMatch(/```artifact-html title="Short descriptive title"```/);
    expect(protocol).not.toMatch(
      /```artifact-html title="Short descriptive title" surface="canvas"```/,
    );
    expect(protocol).not.toMatch(/```svg title="Short descriptive title"```/);
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
