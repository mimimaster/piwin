import { describe, expect, it } from 'vitest';
import { NATIVE_SVG_ARTIFACT_LANGUAGES } from './artifact.js';

describe('SVG artifact contract', () => {
  it('declares the standard svg fence language', () => {
    expect(NATIVE_SVG_ARTIFACT_LANGUAGES).toEqual(['svg']);
  });
});
