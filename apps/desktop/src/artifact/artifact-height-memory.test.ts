// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_HEIGHT_STORAGE_KEY,
  MAX_REMEMBERED_ARTIFACT_HEIGHTS,
  clearArtifactHeightsForTests,
  readRememberedArtifactHeight,
  rememberArtifactHeight,
} from './artifact-height-memory';

describe('artifact height memory', () => {
  it('reuses a height only at the width it was measured at', () => {
    rememberArtifactHeight('m1-artifact-0', 720, 640);
    expect(readRememberedArtifactHeight('m1-artifact-0', 721)).toBe(640);
    expect(readRememberedArtifactHeight('m1-artifact-0', 900)).toBeNull();
    // Before the frame is measured any width is accepted.
    expect(readRememberedArtifactHeight('m1-artifact-0', null)).toBe(640);
  });

  it('keeps the most recent artifacts and clears with its store', () => {
    for (let index = 0; index <= MAX_REMEMBERED_ARTIFACT_HEIGHTS; index += 1) {
      rememberArtifactHeight(`a-${index}`, 720, 100 + index);
    }
    const stored = JSON.parse(window.localStorage.getItem(ARTIFACT_HEIGHT_STORAGE_KEY) ?? '[]') as unknown[];
    expect(stored).toHaveLength(MAX_REMEMBERED_ARTIFACT_HEIGHTS);
    expect(readRememberedArtifactHeight('a-0', 720)).toBeNull();
    expect(readRememberedArtifactHeight(`a-${MAX_REMEMBERED_ARTIFACT_HEIGHTS}`, 720)).toBe(
      100 + MAX_REMEMBERED_ARTIFACT_HEIGHTS,
    );
    clearArtifactHeightsForTests();
    expect(readRememberedArtifactHeight('a-5', 720)).toBeNull();
  });
});
