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
  it('includes metadata header and uses positive Markdown structure without XML wrapper tags', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '[piwin-prompt-meta kind="artifact:decision" version="16" applies="artifacts-enabled"]',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('## Decision Criteria');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('<artifact-decision-policy');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).not.toContain('</artifact-decision-policy>');
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
      'full app/page prototypes',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('architecture / plan / design / codebase reviews');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('a standalone analytical deliverable belongs there');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('user intent');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('wide comparison tables');
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
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('debugging, teaching a specific snippet');
  });

  it('keeps code listings out of artifacts, in a Markdown fence beside them', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('cites code by location (`path:line`)');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'ordinary Markdown code fence before or after the artifact fence',
    );
    const reportKit = formatArtifactKitReference();
    expect(reportKit).toContain('Markdown code fence after the artifact');
    // Listing `pre` among the kit's elements invited whole files into reports.
    expect(reportKit).not.toContain('`pre`');
  });
});

describe('artifact protocol formatter', () => {
  it('is the single surface-rule source, encourages creative freedom, and locks output to artifact-html', () => {
    const protocol = formatArtifactProtocol();
    const kitRef = formatArtifactKitReference();
    expect(protocol).toBe(ARTIFACT_RUNTIME_CONTRACT);
    expect(protocol).toContain('## HTML Artifact Runtime Contract');
    expect(protocol).toContain('Design visual layout and interaction freely');
    expect(protocol).toContain('```artifact-html title="Short descriptive title"');
    expect(protocol).toContain('```artifact-html title="Short descriptive title" surface="canvas"');
    expect(protocol).toContain('surface="canvas"');
    expect(protocol).toContain('--piwin-artifact-');
    expect(protocol).toContain('kind="artifact:runtime" version="18"');
    expect(protocol).toContain('a light host gets a light design and a dark host gets a dark one');
    expect(protocol).toContain('data-piwin-media');
    expect(protocol).toContain('the host resolves the id to the image');
    expect(protocol).toContain('Canvas fills the workspace viewport');
    expect(protocol).toContain('Emit `<style>` complete before any visible HTML markup');
    expect(protocol).toContain(
      'close each visual block before starting siblings',
    );
    expect(protocol).toContain('Keep the outermost wrapper background `transparent`');
    expect(protocol).not.toContain('never a bare');
    expect(protocol).not.toContain('XML-style wrapper tags are not');
    expect(kitRef).toContain('### Report Kit');
    for (const kitClass of ARTIFACT_REPORT_KIT_CLASSES) {
      expect(kitRef).toContain(kitClass);
    }
    for (const tone of ARTIFACT_REPORT_KIT_TONES) {
      expect(kitRef).toContain(`"${tone}"`);
    }
    expect(kitRef).toContain('overflow-wrap: break-word');
    for (const alias of PARSER_ONLY_ALIASES) {
      expect(protocol).not.toContain(alias);
    }
  });

  it('keeps core tokens resident and puts detailed kit references in artifact_instructions', () => {
    const protocol = formatArtifactProtocol();
    const kitRef = formatArtifactKitReference();
    expect(protocol).toContain('`style="host"`');
    expect(protocol).toContain('`style="expressive"`');
    for (const token of ['surface-2', 'border-strong', 'ok, warn, info, risk', 'series-1', 'shadow-1', 'radius-lg']) {
      expect(protocol).toContain(token);
    }
    expect(protocol).toContain('data-piwin-chart');
    expect(kitRef).toContain('"tone": "ok"');
    expect(kitRef).toContain('Donut slices take `tones` in label order.');
    expect(protocol).toContain('Call `artifact_instructions` when you want the syntax reference');
    expect(protocol).not.toContain('trend-up');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('Unprompted artifacts use `style="host"`.');
  });

  it('exposes diagram, viz, and component kits in formatArtifactKitReference', () => {
    const protocol = formatArtifactProtocol();
    const kitRef = formatArtifactKitReference();
    for (const kitClass of ARTIFACT_DIAGRAM_KIT_CLASSES) {
      expect(protocol).toContain(`.${kitClass}`);
      expect(kitRef).toContain(`class="${kitClass}"`);
    }
    expect(protocol).toContain('inline `<svg viewBox="0 0 W H">`');
    for (const kitClass of ARTIFACT_COMPONENT_KIT_CLASSES) {
      expect(kitRef).toContain(`class="${kitClass}"`);
    }
    for (const state of ARTIFACT_COMPONENT_KIT_STATES) {
      expect(kitRef).toContain(`"${state}"`);
    }
    expect(kitRef).toContain('`data-to="<actor>"`');
    expect(kitRef).toContain('`data-dir="down"` — actors in `thead`');
    expect(kitRef).toContain('The kit is a fast default: write your own `<style>`');
  });

  it('shows block fences on their own line, not one-line empty fences', () => {
    const protocol = formatArtifactProtocol();
    expect(protocol).toContain('column 0 of its own line');
    expect(protocol).toContain('together on that one line');
    expect(protocol).toContain('Put a line break between a sentence and the opening fence');
    expect(protocol).toContain('```artifact-html title="Short descriptive title" style="host"\n');
    expect(protocol).toContain(
      '```artifact-html title="Short descriptive title" surface="canvas" style="host"\n',
    );
    expect(protocol).toContain('```svg title="Short descriptive title" style="host"\n');
    expect(protocol).not.toMatch(/```artifact-html title="Short descriptive title" style="host"```/);
    expect(protocol).not.toMatch(
      /```artifact-html title="Short descriptive title" surface="canvas" style="host"```/,
    );
    expect(protocol).not.toMatch(/```svg title="Short descriptive title" style="host"```/);
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
