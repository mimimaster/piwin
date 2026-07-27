import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldCheckbox } from './field.js';

describe('FieldCheckbox', () => {
  it('renders label association and description', () => {
    const markup = renderToStaticMarkup(
      createElement(FieldCheckbox, {
        label: 'Enable automation',
        checked: true,
        description: 'Runs only while host is up',
        testId: 'automation-enabled',
        onCheckedChange: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="automation-enabled"');
    expect(markup).toContain('Enable automation');
    expect(markup).toContain('Runs only while host is up');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
  });

  it('marks disabled state on the root and input', () => {
    const markup = renderToStaticMarkup(
      createElement(FieldCheckbox, {
        label: 'Cron enabled',
        checked: false,
        disabled: true,
        onCheckedChange: () => undefined,
      }),
    );

    expect(markup).toContain('data-disabled="true"');
    expect(markup).toContain('disabled=""');
  });
});
