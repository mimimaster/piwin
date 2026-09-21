import { describe, expect, it } from 'vitest';
import type { PromptInput, ResolvedArtifactCapability } from '@piwin/contracts';
import { createModelPromptAssembly, type ModelPromptAssembly } from '../model-context-assembly.js';

const BOTH_SURFACES: ResolvedArtifactCapability = { enabled: true, inline: true, canvas: true };
const DISABLED: ResolvedArtifactCapability = { enabled: false, inline: false, canvas: false };
import {
  applyInlineArtifactLayout,
  formatArtifactContext,
  formatArtifactLayoutSection,
  formatArtifactThemeSection,
} from './inline-artifact-layout.js';

function summary(assembly: ModelPromptAssembly) {
  return assembly.toSummary({ sessionId: 's', runId: 'r', requestClass: 'prompt', requestOrdinal: 1 });
}

describe('Artifact rendering context', () => {
  it.each([undefined, null, '', '680', '<instruction>', NaN, Infinity, -1, 0, 16385, {}])(
    'ignores invalid client width %s',
    (width) => {
      expect(formatArtifactLayoutSection(width)).toBeUndefined();
    },
  );
  it.each([undefined, null, '', 'Light', 'sepia', '<instruction>', 1, {}])(
    'ignores invalid host theme %s',
    (mode) => {
      expect(formatArtifactThemeSection(mode)).toBeUndefined();
    },
  );
  it('tracks layout-only context as one ledger entry', () => {
    const original: PromptInput = { text: 'Compare phones', inlineArtifactWidthPx: 679.6 };
    const prepared = { ...original };
    const assembly = createModelPromptAssembly();
    applyInlineArtifactLayout(prepared, BOTH_SURFACES, assembly);
    expect(original.text).toBe('Compare phones');
    expect(prepared.inlineArtifactWidthPx).toBeUndefined();
    expect(prepared.text).toContain('approximately 680 CSS px');
    expect(prepared.text).toContain('Never hardcode');
    expect(prepared.text).toContain('360 CSS px');
    expect(prepared.text).toContain('overflow-wrap:break-word only');
    expect(prepared.text).toContain('keep label min-content');
    expect(prepared.text).not.toContain('avoid nowrap on data cells');
    expect(prepared.text).not.toContain('allow table data to wrap');
    expect(prepared.text).toContain('Existing artifact trigger and surface policies still apply');
    expect(prepared.text).not.toContain('Sending client theme');
    expect(prepared.text.endsWith('\n\nCompare phones')).toBe(true);
    const contributions = summary(assembly).contributions;
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.label).toBe('Inline artifact layout');
  });
  it('tells the model the host background so a light host never gets a dark canvas', () => {
    const input: PromptInput = { text: 'Write a report', artifactHostTheme: 'light' };
    const assembly = createModelPromptAssembly();
    applyInlineArtifactLayout(input, BOTH_SURFACES, assembly);
    expect(input).not.toHaveProperty('artifactHostTheme');
    expect(input.text).toContain('Sending client theme: light background');
    expect(input.text).toContain('Never design a dark-mode page');
    expect(input.text.endsWith('\n\nWrite a report')).toBe(true);
    const contributions = summary(assembly).contributions;
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.label).toBe('Artifact host theme');
  });
  it('merges theme and layout into a single block and a single ledger entry', () => {
    const input: PromptInput = {
      text: 'Compare phones',
      inlineArtifactWidthPx: 693,
      artifactHostTheme: 'dark',
    };
    const assembly = createModelPromptAssembly();
    applyInlineArtifactLayout(input, BOTH_SURFACES, assembly);
    expect(input.inlineArtifactWidthPx).toBeUndefined();
    expect(input.artifactHostTheme).toBeUndefined();
    expect(input.text.match(/\[piwin-artifact-context\]/g)).toHaveLength(1);
    expect(input.text.match(/\[\/piwin-artifact-context\]/g)).toHaveLength(1);
    expect(input.text).not.toContain('[piwin-inline-artifact-layout]');
    expect(input.text).not.toContain('[piwin-artifact-host-theme]');
    expect(input.text.indexOf('Sending client theme: dark')).toBeLessThan(
      input.text.indexOf('Sending client chat column'),
    );
    expect(input.text.match(/not an instruction to create an artifact/g)).toHaveLength(1);
    expect(input.text.match(/Existing artifact trigger and surface policies still apply/g)).toHaveLength(1);
    expect(input.text.endsWith('\n\nCompare phones')).toBe(true);
    const contributions = summary(assembly).contributions;
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.label).toBe('Artifact layout + host theme');
    // The ledger keeps a bounded preview: the merged block starts with the tag + theme section.
    expect(contributions[0]?.preview).toContain('Sending client theme: dark');
  });
  it('injects nothing when neither hint is present', () => {
    expect(formatArtifactContext({})).toBeUndefined();
    const input = { text: 'CLI' };
    applyInlineArtifactLayout(input, BOTH_SURFACES, createModelPromptAssembly());
    expect(input.text).toBe('CLI');
  });
  it('does not inject when artifacts are disabled or the shell omits geometry', () => {
    for (const input of [{ text: 'hello', inlineArtifactWidthPx: 680 }, { text: 'hello' }]) {
      applyInlineArtifactLayout(input, DISABLED, createModelPromptAssembly());
      expect(input.text).toBe('hello');
      expect(input).not.toHaveProperty('inlineArtifactWidthPx');
    }
  });
  it('drops the host theme when artifacts are disabled', () => {
    const input: PromptInput = { text: 'hello', artifactHostTheme: 'dark' };
    applyInlineArtifactLayout(input, DISABLED, createModelPromptAssembly());
    expect(input).toEqual({ text: 'hello' });
  });
});

describe('Artifact hint follows the session surfaces', () => {
  it('keeps the theme but drops the chat-column width when only Canvas is available', () => {
    const input: PromptInput = {
      text: 'Compare',
      inlineArtifactWidthPx: 680,
      artifactHostTheme: 'dark',
    };
    const assembly = createModelPromptAssembly();
    applyInlineArtifactLayout(input, { enabled: true, inline: false, canvas: true }, assembly);

    expect(input.text).toContain('Sending client theme: dark');
    expect(input.text).not.toContain('CSS px');
    expect(input).not.toHaveProperty('inlineArtifactWidthPx');
    expect(summary(assembly).contributions[0]?.label).toBe('Artifact host theme');
  });

  it('drops the whole block when the session has no Artifact surface', () => {
    const input: PromptInput = {
      text: 'Refactor',
      inlineArtifactWidthPx: 680,
      artifactHostTheme: 'light',
    };
    applyInlineArtifactLayout(input, DISABLED, createModelPromptAssembly());
    expect(input).toEqual({ text: 'Refactor' });
  });

  it('drops the block when the session class could not be resolved', () => {
    const input: PromptInput = { text: 'Refactor', inlineArtifactWidthPx: 680 };
    applyInlineArtifactLayout(input, undefined, createModelPromptAssembly());
    expect(input).toEqual({ text: 'Refactor' });
  });
});
