// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './skeleton.js';

describe('Skeleton', () => {
  it('announces what is loading and hides the bars', () => {
    const html = renderToStaticMarkup(<Skeleton label="正在加载会话" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="正在加载会话"');
    expect(html.match(/ui-skeleton-bar/g)).toHaveLength(3);
    expect(html).toContain('aria-hidden="true"');
  });

  it('draws one bar per requested width', () => {
    const html = renderToStaticMarkup(<Skeleton label="x" rows={[40, 80]} />);
    expect(html).toContain('width:40%');
    expect(html).toContain('width:80%');
    expect(html.match(/ui-skeleton-bar/g)).toHaveLength(2);
  });

  it('leads list rows with a dot and renders a block as one area', () => {
    expect(renderToStaticMarkup(<Skeleton label="x" variant="list" rows={[50]} />)).toContain(
      'ui-skeleton-dot',
    );
    const block = renderToStaticMarkup(<Skeleton label="x" variant="block" rows={[10, 20]} />);
    expect(block.match(/ui-skeleton-bar/g)).toHaveLength(1);
    expect(block).toContain('ui-skeleton--block');
  });
});
