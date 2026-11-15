import { describe, expect, it } from 'vitest';
import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import { createArtifactFenceRecord } from './fence-index.js';
import { analyzeArtifactFence } from './render-intent.js';
import { materializeArtifact } from './materialize.js';
import { createArtifactMediaBinding } from './media-budget.js';
import type { ArtifactRenderMode, ArtifactSurface } from './types.js';

const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SOURCE = `<section><p>中文图片汇总 🦉</p><img data-piwin-media="${MEDIA_ID}"><img data-piwin-media="${MEDIA_ID}"></section>`;
const DATA_URL = 'data:image/jpeg;base64,AAAA';
const scenarios: Array<{ mode: ArtifactRenderMode; presentation: ArtifactSurface }> = [
  { mode: 'interactive', presentation: 'inline' },
  { mode: 'interactive', presentation: 'canvas' },
  { mode: 'stream-preview', presentation: 'inline' },
];

describe('complete-document media budget', () => {
  it.each(scenarios)('matches normal materialization for $mode / $presentation', (options) => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({ info: 'artifact-html style="host"', source: SOURCE }),
    );
    if (analysis.kind !== 'intent') throw new Error('expected render intent');
    const base = materializeArtifact(analysis.intent, options);
    const binding = createArtifactMediaBinding(base);
    const mediaDataUrls = new Map([[MEDIA_ID, DATA_URL]]);
    expect(binding.bind(mediaDataUrls)).toEqual(
      materializeArtifact(analysis.intent, { ...options, mediaDataUrls }),
    );
    expect(base.intent.descriptor.source).toBe(SOURCE);
    expect(base.renderSource).not.toContain(DATA_URL);
  });

  it('reserves UTF-8, runtime/theme and each repeated src attribute exactly', () => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({ info: 'artifact-html', source: SOURCE }),
    );
    if (analysis.kind !== 'intent') throw new Error('expected render intent');
    const base = materializeArtifact(analysis.intent, {
      mode: 'interactive',
      presentation: 'canvas',
    });
    if (base.document.kind !== 'sandbox') throw new Error('expected sandbox');
    const binding = createArtifactMediaBinding(base);
    expect(binding.budget.references.get(MEDIA_ID)).toBe(2);
    const nonImageBytes = new TextEncoder().encode(base.document.srcdoc).length;
    expect(binding.budget.maxCharacters).toBe(
      MAX_ARTIFACT_DOCUMENT_BYTES - nonImageBytes - 2 * ' src=""'.length,
    );
    expect(nonImageBytes).toBeGreaterThan(new TextEncoder().encode(SOURCE).length);

    const prefix = 'data:image/jpeg;base64,';
    const quota = Math.floor(binding.budget.maxCharacters / 2);
    const fitted = binding.bind(new Map([[MEDIA_ID, prefix + 'A'.repeat(quota - prefix.length)]]));
    if (fitted.document.kind !== 'sandbox') throw new Error('expected sandbox');
    const bytes = new TextEncoder().encode(fitted.document.srcdoc).length;
    expect(bytes).toBeLessThanOrEqual(MAX_ARTIFACT_DOCUMENT_BYTES);
    expect(MAX_ARTIFACT_DOCUMENT_BYTES - bytes).toBeLessThan(2);
  });

  it('recomputes a fullscreen sandbox budget from an existing static binding', () => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({ info: 'artifact-html style="host"', source: SOURCE }),
    );
    if (analysis.kind !== 'intent') throw new Error('expected render intent');
    const inline = createArtifactMediaBinding(
      materializeArtifact(analysis.intent, { mode: 'interactive' }),
    );
    const fullscreen = createArtifactMediaBinding(
      materializeArtifact(analysis.intent, { mode: 'interactive', presentation: 'canvas' }),
    );
    expect(fullscreen.budget.maxCharacters).toBeLessThan(inline.budget.maxCharacters);
    expect(fullscreen.bind(new Map([[MEDIA_ID, DATA_URL]])).intent.descriptor.source).toBe(SOURCE);
  });
});
