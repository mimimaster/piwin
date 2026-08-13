import { describe, expect, it } from 'vitest';
import { buildArtifactDocumentDataUrl } from './artifact-frame-stream.js';

function decodeDataUrl(url: string): string {
  const separator = url.indexOf(',');
  if (separator < 0) {
    throw new Error('Artifact data URL has no payload');
  }
  const binary = atob(url.slice(separator + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe('Artifact document transport', () => {
  it('round-trips Unicode HTML through an opaque data URL', () => {
    const srcdoc = '<!doctype html><title>鹈鹕</title><div>自然撑开</div>';
    const url = buildArtifactDocumentDataUrl(srcdoc);

    expect(url).toMatch(/^data:text\/html;charset=utf-8;base64,/);
    expect(decodeDataUrl(url)).toBe(srcdoc);
  });
});
