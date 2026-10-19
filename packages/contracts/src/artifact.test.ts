import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CANVAS_ONLY_HINT,
  ARTIFACT_EXPLICIT_ONLY_HINT,
  ARTIFACT_HOST_STYLE_ONLY_HINT,
  formatArtifactKitReference,
  ARTIFACT_INLINE_ONLY_HINT,
  ARTIFACT_LANGUAGE_ALIASES,
  ARTIFACT_RUNTIME_CONTRACT,
  CANONICAL_ARTIFACT_LANGUAGE,
  DEFAULT_ARTIFACT_DECISION_PROMPT,
  DISABLED_ARTIFACT_CAPABILITY,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  createDefaultArtifactConfig,
  createDefaultArtifactScopes,
  formatArtifactInstructions,
  formatArtifactProtocol,
  resolveArtifactCapability,
  resolveArtifactDecisionPrompt,
  resolveArtifactSurfaceHint,
  type ArtifactSurface,
} from './artifact.js';
import { ARTIFACT_COMPONENT_KIT_CLASSES, ARTIFACT_COMPONENT_KIT_STATES } from './artifact-component-kit.js';
import { ARTIFACT_DIAGRAM_KIT_CLASSES } from './artifact-diagram-kit.js';
import { ARTIFACT_REPORT_KIT_CLASSES, ARTIFACT_REPORT_KIT_TONES } from './artifact-report-kit.js';

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
  it('keeps resident instructions within 2000 characters including every product restriction', () => {
    const config = createDefaultArtifactConfig();
    const capabilities = [
      { enabled: true, inline: true, canvas: true },
      { enabled: true, inline: true, canvas: false },
      { enabled: true, inline: false, canvas: true },
    ];
    for (const triggerMode of ['automatic', 'explicit-only'] as const) {
      for (const styleModes of ['model', 'host-only'] as const) {
        for (const capability of capabilities) {
          expect(formatArtifactInstructions({ ...config, triggerMode, styleModes }, capability).length)
            .toBeLessThanOrEqual(2000);
        }
      }
    }
  });

  it('keeps proactive semantic routing without XML wrappers or length-based promotion', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('## Decision Criteria');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('proactively');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Markdown');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Inline:');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Canvas: standalone reports, reviews, audits');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('user intent, not length');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toMatch(/<\/?artifact/);
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('```');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('wall of text');
  });

  it('preserves custom policies and falls back when the custom policy is blank', () => {
    const config = createDefaultArtifactConfig();
    config.decisionPrompt = { mode: 'custom', customPrompt: 'custom routing' };
    expect(resolveArtifactDecisionPrompt(config)).toBe('custom routing');
    config.decisionPrompt.customPrompt = '  ';
    expect(resolveArtifactDecisionPrompt(config)).toBe(DEFAULT_ARTIFACT_DECISION_PROMPT);
  });
});

describe('artifact protocol formatter', () => {
  it('teaches two complete canonical fences with explicit surface and style semantics', () => {
    const protocol = formatArtifactProtocol();
    const examples = [...protocol.matchAll(/^```([^\n]+)\n([\s\S]*?)\n```$/gm)];
    expect(protocol).toBe(ARTIFACT_RUNTIME_CONTRACT);
    expect(examples.map((match) => match[1])).toEqual([
      'artifact-html title="Title" style="host"',
      'artifact-html title="Title" surface="canvas" style="host"',
    ]);
    for (const example of examples) {
      expect(example[2]).toContain('<main class="piwin-report">');
    }
    expect(protocol).toContain('column 0');
    expect(protocol).toContain('never XML wrapper tags');
    expect(protocol).toContain('`svg` fence');
    expect(protocol).toContain('`style="expressive"`');
    expect(protocol).toContain('data-piwin-media');
    expect(protocol).toContain('no network');
    expect(protocol).toContain('Core content in HTML; CSS before markup');
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(formatArtifactInstructions(createDefaultArtifactConfig())).not.toContain(alias);
    }
  });

  it('keeps authoring details on demand while retaining essential theme and sizing guidance', () => {
    const protocol = formatArtifactProtocol();
    const reference = formatArtifactKitReference();
    expect(protocol).toContain('--piwin-artifact-*');
    expect(protocol).toContain('transparent');
    expect(protocol).toContain('light/dark');
    expect(protocol).toContain('auto height');
    expect(protocol).toContain('Canvas fills its viewport');
    expect(protocol).toContain('`artifact_instructions`');
    for (const detail of ['overflow-wrap: break-word', 'series-1', 'radius-lg', 'trend-up', 'piwin-flow', 'piwin-matrix']) {
      expect(protocol).not.toContain(detail);
      expect(reference).toContain(detail);
    }
    expect(reference).not.toContain('## Decision Criteria');
    expect(reference).not.toContain('## HTML Artifact Runtime Contract');
  });

  it('retains every report, diagram and component vocabulary entry in the reference', () => {
    const reference = formatArtifactKitReference();
    for (const kitClass of [
      ...ARTIFACT_REPORT_KIT_CLASSES,
      ...ARTIFACT_DIAGRAM_KIT_CLASSES,
      ...ARTIFACT_COMPONENT_KIT_CLASSES,
    ]) {
      expect(reference).toContain(kitClass);
    }
    for (const state of [...ARTIFACT_REPORT_KIT_TONES, ...ARTIFACT_COMPONENT_KIT_STATES]) {
      expect(reference).toContain(`"${state}"`);
    }
    expect(reference).toContain('piwin.chart(');
    expect(reference).toContain('data-piwin-viz="KIND"');
    expect(reference).toContain('Wrap a whole sentence');
    expect(reference).toContain('Close each visual block');
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

  it('adds the host-style-only hint only for the internal host-only switch', () => {
    const config = createDefaultArtifactConfig();
    expect(formatArtifactInstructions(config)).not.toContain(ARTIFACT_HOST_STYLE_ONLY_HINT);
    config.styleModes = 'host-only';
    const instructions = formatArtifactInstructions(config);
    expect(instructions.startsWith(ARTIFACT_HOST_STYLE_ONLY_HINT)).toBe(true);
    expect(instructions).toContain(formatArtifactProtocol());
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

describe('per-scope Artifact capability', () => {
  it('ships Conversation chat on and Agent chat Canvas-only', () => {
    expect(createDefaultArtifactConfig().scopes).toEqual(createDefaultArtifactScopes());
    expect(createDefaultArtifactScopes()).toEqual({
      general: { inline: true, canvas: true },
      project: { inline: false, canvas: true },
    });
  });

  it('follows the shipped default for a missing scope or surface', () => {
    const config = createDefaultArtifactConfig();
    delete config.scopes;
    expect(resolveArtifactCapability(config, 'general')).toEqual({
      enabled: true,
      inline: true,
      canvas: true,
    });
    // A config written before `scopes` existed adopts the shipped default
    // rather than keeping a surface the user never chose.
    expect(resolveArtifactCapability(config, 'project')).toEqual({
      enabled: true,
      inline: false,
      canvas: true,
    });

    config.scopes = {
      general: { inline: true, canvas: true },
      project: { inline: true, canvas: true },
    };
    expect(resolveArtifactCapability(config, 'project').inline).toBe(true);
  });

  it('treats a partial scope entry per surface', () => {
    const config = createDefaultArtifactConfig();
    config.scopes = {
      general: { inline: true, canvas: true },
      project: { canvas: false } as { inline: boolean; canvas: boolean },
    };
    // The missing surface follows the default (Inline off for Agent chat), not "on".
    expect(resolveArtifactCapability(config, 'project')).toEqual(DISABLED_ARTIFACT_CAPABILITY);
  });

  it('gates each scope independently and collapses to disabled when empty', () => {
    const config = createDefaultArtifactConfig();
    config.scopes = {
      general: { inline: true, canvas: false },
      project: { inline: false, canvas: false },
    };
    expect(resolveArtifactCapability(config, 'general')).toEqual({
      enabled: true,
      inline: true,
      canvas: false,
    });
    expect(resolveArtifactCapability(config, 'project')).toEqual(
      DISABLED_ARTIFACT_CAPABILITY,
    );
  });

  it('master switch beats every scope switch and undefined config stays default', () => {
    const config = createDefaultArtifactConfig();
    config.enabled = false;
    config.scopes = {
      general: { inline: true, canvas: true },
      project: { inline: true, canvas: true },
    };
    expect(resolveArtifactCapability(config, 'general')).toEqual(DISABLED_ARTIFACT_CAPABILITY);
    // Undefined config keeps the shipped default per scope.
    expect(resolveArtifactCapability(undefined, 'general')).toEqual({
      enabled: true,
      inline: true,
      canvas: true,
    });
    expect(resolveArtifactCapability(undefined, 'project')).toEqual({
      enabled: true,
      inline: false,
      canvas: true,
    });
  });

  it('hints only the restricted surface and never weakens the shared protocol', () => {
    expect(resolveArtifactSurfaceHint({ enabled: true, inline: true, canvas: true })).toBeUndefined();
    expect(
      resolveArtifactSurfaceHint({ enabled: true, inline: true, canvas: false }),
    ).toBe(ARTIFACT_INLINE_ONLY_HINT);
    expect(
      resolveArtifactSurfaceHint({ enabled: true, inline: false, canvas: true }),
    ).toBe(ARTIFACT_CANVAS_ONLY_HINT);
    expect(resolveArtifactSurfaceHint(DISABLED_ARTIFACT_CAPABILITY)).toBeUndefined();
  });

  it('prefixes the surface constraint and drops the instructions when disabled', () => {
    const config = createDefaultArtifactConfig();
    expect(
      formatArtifactInstructions(config, { enabled: true, inline: true, canvas: false }),
    ).toBe(`${ARTIFACT_INLINE_ONLY_HINT}\n\n${formatArtifactInstructions(config)}`);
    expect(
      formatArtifactInstructions(config, { enabled: true, inline: false, canvas: true }),
    ).toBe(`${ARTIFACT_CANVAS_ONLY_HINT}\n\n${formatArtifactInstructions(config)}`);
    expect(formatArtifactInstructions(config, DISABLED_ARTIFACT_CAPABILITY)).toBe('');
    // No capability argument keeps the pre-scope behavior for existing callers.
    expect(formatArtifactInstructions(config)).toBe(
      `${DEFAULT_ARTIFACT_DECISION_PROMPT}\n\n${formatArtifactProtocol()}`,
    );
  });

  it('keeps explicit-only and surface constraints in a stable order', () => {
    const config = createDefaultArtifactConfig();
    config.triggerMode = 'explicit-only';
    expect(
      formatArtifactInstructions(config, { enabled: true, inline: false, canvas: true }).startsWith(
        `${ARTIFACT_EXPLICIT_ONLY_HINT}\n\n${ARTIFACT_CANVAS_ONLY_HINT}`,
      ),
    ).toBe(true);
  });
});
