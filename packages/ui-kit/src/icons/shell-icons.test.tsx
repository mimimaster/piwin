import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconChat, IconMcp, IconStop } from './shell-icons.js';

describe('shared shell icons', () => {
  it('preserves the shared outline defaults', () => {
    const markup = renderToStaticMarkup(createElement(IconChat));

    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="2"');
    expect(markup).toContain('class="tabler-icon');
  });

  it('allows callers to override dimensions and presentation attributes', () => {
    const markup = renderToStaticMarkup(
      createElement(IconChat, {
        className: 'custom-icon',
        width: 18,
        height: 18,
        strokeWidth: 2,
      }),
    );

    expect(markup).toContain('custom-icon');
    expect(markup).toContain('width="18"');
    expect(markup).toContain('height="18"');
    expect(markup).toContain('stroke-width="2"');
  });

  it('preserves filled icons instead of converting them to white outlines', () => {
    const stopMarkup = renderToStaticMarkup(createElement(IconStop));
    const mcpMarkup = renderToStaticMarkup(createElement(IconMcp));

    expect(stopMarkup).toContain('stroke="currentColor"');
    expect(mcpMarkup).toContain('fill="currentColor"');
    expect(mcpMarkup).toContain('stroke="none"');
  });
});
