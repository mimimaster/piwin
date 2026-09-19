import { describe, expect, it } from 'vitest';
import type { PromptInput } from '@piwin/contracts';
import { createModelPromptAssembly } from '../model-context-assembly.js';
import {
  applyInlineArtifactLayout,
  formatArtifactHostTheme,
  formatInlineArtifactLayout,
} from './inline-artifact-layout.js';

describe('Inline artifact layout context', () => {
  it.each([undefined, null, '', '680', '<instruction>', NaN, Infinity, -1, 0, 16385, {}])(
    'ignores invalid client width %s', (width) => {
      expect(formatInlineArtifactLayout(width)).toBeUndefined();
    },
  );
  it('adds advisory context only to the prepared prompt and tracks its cost', () => {
    const original: PromptInput = { text: 'Compare phones', inlineArtifactWidthPx: 679.6 };
    const prepared = { ...original };
    const assembly = createModelPromptAssembly();
    applyInlineArtifactLayout(prepared, true, assembly);
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
    expect(prepared.text.endsWith('\n\nCompare phones')).toBe(true);
    expect(assembly.toSummary({ sessionId: 's', runId: 'r', requestClass: 'prompt', requestOrdinal: 1 })
      .contributions).toHaveLength(1);
  });
  it('does not inject when artifacts are disabled or the shell omits geometry', () => {
    for (const input of [{ text: 'hello', inlineArtifactWidthPx: 680 }, { text: 'hello' }]) {
      applyInlineArtifactLayout(input, false, createModelPromptAssembly());
      expect(input.text).toBe('hello');
      expect(input).not.toHaveProperty('inlineArtifactWidthPx');
    }
    const input = { text: 'CLI' };
    applyInlineArtifactLayout(input, true, createModelPromptAssembly());
    expect(input.text).toBe('CLI');
  });
  it.each([undefined, null, '', 'Light', 'sepia', '<instruction>', 1, {}])(
    'ignores invalid host theme %s', (mode) => {
      expect(formatArtifactHostTheme(mode)).toBeUndefined();
    },
  );
  it('tells the model the host background so a light host never gets a dark canvas', () => {
    const input: PromptInput = { text: 'Write a report', artifactHostTheme: 'light' };
    const assembly = createModelPromptAssembly();
    applyInlineArtifactLayout(input, true, assembly);
    expect(input).not.toHaveProperty('artifactHostTheme');
    expect(input.text).toContain('Sending client theme: light background');
    expect(input.text).toContain('Never design a dark-mode page');
    expect(input.text.endsWith('\n\nWrite a report')).toBe(true);
    expect(assembly.toSummary({ sessionId: 's', runId: 'r', requestClass: 'prompt', requestOrdinal: 1 })
      .contributions).toHaveLength(1);
  });
  it('drops the host theme when artifacts are disabled', () => {
    const input: PromptInput = { text: 'hello', artifactHostTheme: 'dark' };
    applyInlineArtifactLayout(input, false, createModelPromptAssembly());
    expect(input).toEqual({ text: 'hello' });
  });
});
