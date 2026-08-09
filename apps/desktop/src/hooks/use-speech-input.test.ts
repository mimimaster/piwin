import { describe, expect, it } from 'vitest';
import { bytesToBase64, chooseRecorderMimeType } from './use-speech-input.js';

describe('speech input helpers', () => {
  it('prefers an Opus WebM recorder and falls back through supported containers', () => {
    expect(chooseRecorderMimeType(() => false)).toBe('');
    expect(chooseRecorderMimeType((mimeType) => mimeType === 'audio/mp4')).toBe('audio/mp4');
    expect(chooseRecorderMimeType((mimeType) => mimeType === 'audio/webm')).toBe('audio/webm');
  });

  it('encodes recorder bytes without changing their contents', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 255]))).toBe('AAEC/w==');
  });
});
