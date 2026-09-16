// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ProgressRing } from './progress-ring.js';

describe('ProgressRing', () => {
  it('renders determinate progress ring with correct value and aria attributes', () => {
    const markup = renderToString(<ProgressRing value={45} label="Installing package" />);

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="45"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
    expect(markup).toContain('aria-label="Installing package"');
    expect(markup).toContain('data-value="45"');
    expect(markup).toContain('ui-progress-ring--pine');
    expect(markup).toContain('is-determinate');
  });

  it('renders indeterminate spinner when value is undefined', () => {
    const markup = renderToString(<ProgressRing />);

    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).toContain('is-indeterminate');
    expect(markup).toContain('aria-label="Loading…"');
  });

  it('clamps percentage value between 0 and 100', () => {
    const under = renderToString(<ProgressRing value={-20} />);
    expect(under).toContain('data-value="0"');
    expect(under).toContain('aria-valuenow="0"');

    const over = renderToString(<ProgressRing value={150} />);
    expect(over).toContain('data-value="100"');
    expect(over).toContain('aria-valuenow="100"');
  });

  it('renders numeric percentage text when showValue is true', () => {
    const markup = renderToString(<ProgressRing value={68} showValue />);
    expect(markup).toContain('class="ui-progress-ring-text"');
    expect(markup).toContain('68%');
  });

  it('applies custom tone and size', () => {
    const markup = renderToString(<ProgressRing value={30} tone="zhu" size={32} />);
    expect(markup).toContain('ui-progress-ring--zhu');
    expect(markup).toContain('width:32px;height:32px');
  });
});
