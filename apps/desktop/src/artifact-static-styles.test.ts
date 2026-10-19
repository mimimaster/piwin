// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  authorizeStaticArtifactStyles,
  parseStyleDeclaration,
  splitStyleDeclarations,
} from './artifact-static-styles.js';

vi.mock('./host-style-nonce.js', () => ({
  readHostStyleNonce: () => 'test-nonce',
}));

describe('splitStyleDeclarations', () => {
  it('splits on top-level semicolons only', () => {
    expect(splitStyleDeclarations('color: red; padding: 1px 2px')).toEqual([
      'color: red',
      ' padding: 1px 2px',
    ]);
  });

  it('keeps semicolons and colons nested in functions and quotes whole', () => {
    expect(
      splitStyleDeclarations(
        'background: color-mix(in srgb, var(--x) 50%, transparent); content: "a; b"',
      ),
    ).toEqual([
      'background: color-mix(in srgb, var(--x) 50%, transparent)',
      ' content: "a; b"',
    ]);
  });

  it('drops empty declarations', () => {
    expect(splitStyleDeclarations('; color: red ;;')).toEqual([' color: red ']);
  });
});

describe('parseStyleDeclaration', () => {
  it('parses a shorthand holding a var() without expanding it', () => {
    expect(parseStyleDeclaration('border: 1px solid var(--y)')).toEqual({
      name: 'border',
      value: '1px solid var(--y)',
      priority: '',
    });
  });

  it('extracts !important into the priority field', () => {
    expect(parseStyleDeclaration('color: red !important')).toEqual({
      name: 'color',
      value: 'red',
      priority: 'important',
    });
  });

  it('rejects declarations without a name or value', () => {
    expect(parseStyleDeclaration('color')).toBeNull();
    expect(parseStyleDeclaration(': red')).toBeNull();
    expect(parseStyleDeclaration('color:')).toBeNull();
  });
});

describe('authorizeStaticArtifactStyles', () => {
  it('preserves shorthand declarations that reference theme variables', () => {
    const base = document.createElement('style');
    const content = document.createElement('div');
    const card = document.createElement('div');
    card.setAttribute(
      'style',
      'background: var(--piwin-artifact-surface); border: 1px solid var(--piwin-artifact-border); border-radius: 10px; color: var(--piwin-artifact-text)',
    );
    content.appendChild(card);

    authorizeStaticArtifactStyles(base, content);

    // The regression dropped these two shorthands entirely (empty string);
    // the fix keeps the declaration (CSSOM serialization of the nested var()
    // varies by engine, so assert survival rather than exact text here).
    expect(card.style.getPropertyValue('background')).toBe('var(--piwin-artifact-surface)');
    expect(card.style.getPropertyValue('border')).toContain('1px solid');
    expect(card.style.getPropertyValue('border-radius')).toBe('10px');
    expect(card.style.getPropertyValue('color')).toBe('var(--piwin-artifact-text)');
  });
});
