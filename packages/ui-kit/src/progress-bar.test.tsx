// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ProgressBar } from './progress-bar.js';

describe('ProgressBar', () => {
  it('renders determinate width and aria values', () => {
    const markup = renderToString(<ProgressBar value={40} label="Installing" />);
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="40"');
    expect(markup).toContain('aria-label="Installing"');
    expect(markup).toContain('width:40%');
    expect(markup).toContain('is-determinate');
  });

  it('renders an indeterminate sweep without a fake value', () => {
    const markup = renderToString(<ProgressBar tone="azure" />);
    expect(markup).toContain('is-indeterminate');
    expect(markup).toContain('ui-progress-bar--azure');
    expect(markup).not.toContain('aria-valuenow');
  });

  it('clamps out-of-range values', () => {
    expect(renderToString(<ProgressBar value={140} />)).toContain('aria-valuenow="100"');
    expect(renderToString(<ProgressBar value={-5} />)).toContain('aria-valuenow="0"');
  });
});
