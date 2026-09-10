import { describe, expect, it } from 'vitest';
import type { PromptInput } from '@piwin/contracts';
import { createModelPromptAssembly } from '../model-context-assembly.js';
import { applyInlineArtifactLayout, formatInlineArtifactLayout } from './inline-artifact-layout.js';

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
});
