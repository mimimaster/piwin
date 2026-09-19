import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  IconBrain,
  IconChat,
  IconClock,
  IconDatabase,
  IconCompress,
  IconExpand,
  IconFlame,
  IconFolderOpen,
  IconMcp,
  IconServer,
  IconSettings,
  IconStop,
  IconTable,
} from './shell-icons.js';

describe('shared shell icons', () => {
  it('renders IconBrain as the two-hemisphere thinking glyph', () => {
    const markup = renderToStaticMarkup(createElement(IconBrain));
    expect(markup).toContain('viewBox="0 0 16 16"');
    expect(markup).toContain('M7.5 3.2');
    expect(markup).toContain('M8 3v10');
    expect(markup).not.toContain('<rect');
  });

  it('renders IconFolderOpen as a single thin outline path', () => {
    const markup = renderToStaticMarkup(createElement(IconFolderOpen));
    expect(markup).toContain('stroke-width="1.6"');
    expect(markup.match(/<path /g)).toHaveLength(1);
  });

  it('renders IconExpand on the 24 grid with inset arrows', () => {
    const markup = renderToStaticMarkup(createElement(IconExpand));
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('M16 4h4v4');
    expect(markup).not.toContain('M9.5 2H14');
  });

  it('renders IconCompress as the inset inverse of IconExpand', () => {
    const markup = renderToStaticMarkup(createElement(IconCompress));
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('M5 9h4V5');
    expect(markup).not.toContain('M14.5 4.75');
  });

  it('preserves the shared outline defaults', () => {
    const markup = renderToStaticMarkup(createElement(IconChat));

    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('width="1em"');
    expect(markup).toContain('height="1em"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="1.6"');
    expect(markup).toContain('class="tabler-icon"');
  });

  it('renders IconFlame and IconTable with outline defaults', () => {
    const flameMarkup = renderToStaticMarkup(createElement(IconFlame));
    const tableMarkup = renderToStaticMarkup(createElement(IconTable));

    expect(flameMarkup).toContain('viewBox="0 0 24 24"');
    expect(flameMarkup).toContain('class="tabler-icon"');
    expect(tableMarkup).toContain('viewBox="0 0 24 24"');
    expect(tableMarkup).toContain('class="tabler-icon"');
  });

  it('renders IconServer as a paired location glyph', () => {
    const markup = renderToStaticMarkup(createElement(IconServer));
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('class="tabler-icon"');
    expect(markup).toContain('rect');
  });

  it('renders telemetry icons in the shared outline family', () => {
    const clockMarkup = renderToStaticMarkup(createElement(IconClock));
    const databaseMarkup = renderToStaticMarkup(createElement(IconDatabase));

    expect(clockMarkup).toContain('class="tabler-icon"');
    expect(clockMarkup).toContain('<circle');
    expect(databaseMarkup).toContain('class="tabler-icon"');
    expect(databaseMarkup).toContain('<ellipse');
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

  it('preserves filled shape attributes for filled/solid icons', () => {
    const stopMarkup = renderToStaticMarkup(createElement(IconStop));
    const mcpMarkup = renderToStaticMarkup(createElement(IconMcp));

    expect(stopMarkup).toContain('fill="currentColor"');
    expect(stopMarkup).toContain('stroke="none"');
    expect(mcpMarkup).toContain('circle cx="12" cy="12"');
  });

  it('renders IconSettings as the 6-tooth gear outline', () => {
    const markup = renderToStaticMarkup(createElement(IconSettings));
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('class="tabler-icon"');
    expect(markup).toContain('M12.22 2h-.44');
    expect(markup).toContain('<circle cx="12" cy="12" r="3"');
  });
});
