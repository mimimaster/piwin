import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { sanitizeMarkdownChild } from './markdown-streamdown-nodes';

describe('sanitizeMarkdownChild', () => {
  it('passes through elements, strings, and arrays', () => {
    expect(sanitizeMarkdownChild('hi')).toBe('hi');
    expect(sanitizeMarkdownChild(3)).toBe(3);
    expect(sanitizeMarkdownChild(null)).toBeNull();
    const element = createElement('span', null, 'ok');
    expect(sanitizeMarkdownChild(element)).toBe(element);
    expect(sanitizeMarkdownChild(['a', element])).toEqual(['a', element]);
  });

  it('drops leaked MDAST-like objects that would crash React', () => {
    const leaked = { type: 'text', value: 'nope' } as unknown as ReactNode;
    expect(sanitizeMarkdownChild(leaked)).toBeNull();
    expect(sanitizeMarkdownChild([leaked, 'kept'])).toEqual([null, 'kept']);
  });

  it('keeps portals and thenables React can still render', () => {
    const portal = { $$typeof: Symbol.for('react.portal'), key: null } as unknown as ReactNode;
    expect(sanitizeMarkdownChild(portal)).toBe(portal);
    const thenable = Promise.resolve('x') as unknown as ReactNode;
    expect(sanitizeMarkdownChild(thenable)).toBe(thenable);
  });
});
