import { describe, expect, it } from 'vitest';
import {
  findOpenArtifactFence,
  normalizeStreamingArtifactFences,
} from './streaming.js';

describe('findOpenArtifactFence', () => {
  it('finds an incomplete html fence', () => {
    const content = 'Hello\n```html\n<div class="card">Hi';
    const open = findOpenArtifactFence(content, true);
    expect(open).not.toBeNull();
    expect(open?.info).toBe('html');
  });

  it('returns null when fence is closed', () => {
    const content = '```html\n<div>x</div>\n```';
    expect(findOpenArtifactFence(content, true)).toBeNull();
  });

  it('returns null when html ui mode disabled', () => {
    expect(findOpenArtifactFence('```html\n<div>', false)).toBeNull();
  });
});

describe('normalizeStreamingArtifactFences', () => {
  it('closes open artifact fence when not done', () => {
    const content = '```html\n<div class="x">hello';
    const normalized = normalizeStreamingArtifactFences(content, true, false);
    expect(normalized.trimEnd().endsWith('```')).toBe(true);
    expect(findOpenArtifactFence(normalized, true)).toBeNull();
  });

  it('does not append fence when done', () => {
    const content = '```html\n<div>x</div>\n```';
    expect(normalizeStreamingArtifactFences(content, true, true)).toBe(content);
  });
});
