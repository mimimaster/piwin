import { describe, expect, it } from 'vitest';
import { createArtifactFenceRecord } from '@piwin/artifact';
import { lookupIndexedFence } from './markdown-artifact-fence-lookup.js';

const htmlFence = createArtifactFenceRecord({
  info: 'artifact-html',
  source: '<section>Hi</section>',
  ordinal: 0,
  startOffset: 40,
});
const tsFence = createArtifactFenceRecord({
  info: 'ts',
  source: 'export const x = 1',
  ordinal: 1,
  startOffset: 120,
});

describe('lookupIndexedFence', () => {
  it('binds by projected start offset when Streamdown reports a document offset', () => {
    const record = lookupIndexedFence({
      fences: [htmlFence, tsFence],
      ordinalByProjectedStartOffset: new Map([
        [40, 0],
        [120, 1],
      ]),
      startOffset: 40,
      language: 'artifact-html',
    });
    expect(record?.ordinal).toBe(0);
  });

  it('falls back to a unique language match when the offset is missing', () => {
    const record = lookupIndexedFence({
      fences: [htmlFence, tsFence],
      ordinalByProjectedStartOffset: new Map([
        [40, 0],
        [120, 1],
      ]),
      startOffset: 0,
      language: 'artifact-html',
    });
    expect(record?.ordinal).toBe(0);
  });

  it('does not guess when two fences share the language and the offset misses', () => {
    const secondHtml = createArtifactFenceRecord({
      info: 'artifact-html',
      source: '<section>Two</section>',
      ordinal: 1,
      startOffset: 120,
    });
    expect(
      lookupIndexedFence({
        fences: [htmlFence, secondHtml],
        ordinalByProjectedStartOffset: new Map([
          [40, 0],
          [120, 1],
        ]),
        startOffset: undefined,
        language: 'artifact-html',
      }),
    ).toBeNull();
  });
});
