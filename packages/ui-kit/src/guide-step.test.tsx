import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuideStep } from './guide-step.js';

describe('GuideStep', () => {
  it('numbers a pending step and renders its body', () => {
    const markup = renderToStaticMarkup(
      createElement(
        GuideStep,
        { index: 2, title: 'Relay', summary: 'Optional path', state: 'active', testId: 'step' },
        createElement('input', { 'data-testid': 'body-field' }),
      ),
    );
    expect(markup).toContain('piwin-guide-step is-active');
    expect(markup).toContain('>2<');
    expect(markup).toContain('Optional path');
    expect(markup).toContain('piwin-guide-step-body');
    expect(markup).toContain('data-testid="step"');
  });

  it('shows a check instead of the number once done, and no empty body', () => {
    const markup = renderToStaticMarkup(
      createElement(GuideStep, { index: 1, title: 'Allow', state: 'done' }, null, false),
    );
    expect(markup).toContain('is-done');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('piwin-guide-step-body');
  });
});
