/**
 * Class-name contract for ui-kit primitives (plan: quiet-workbench P0-D).
 * `@piwin/ui-kit/styles.css` (src/primitives.css) styles primitives purely
 * through these public class names, so renaming one silently detaches its
 * CSS. Assertions pin ui-kit-owned classes only — never private Mantine
 * hashes.
 */
import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PiwinUiProvider } from './piwin-ui-provider.js';
import { Button } from './button.js';
import { IconButton } from './icon-button.js';
import { Field, FieldCheckbox } from './field.js';
import { ListRow } from './list-row.js';
import { Surface } from './surface.js';
import { StatusBadge } from './status-badge.js';
import { Notice } from './notice.js';
import { Spinner } from './spinner.js';
import { ProgressRing } from './progress-ring.js';
import { Toast } from './toast.js';
import { TextArea } from './textarea.js';
import { NumberInput } from './number-input.js';
import { EmptyState } from './empty-state.js';
import { TEST_THEME_DARK } from './test-theme-fixtures.js';

/** Mantine-backed primitives need the provider even for static markup. */
function renderWithProvider(child: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(PiwinUiProvider, { manifest: TEST_THEME_DARK, children: child }),
  );
}

describe('primitive class contract', () => {
  it('Button exposes piwin-button base, variant, and size classes', () => {
    const markup = renderWithProvider(
      createElement(Button, { variant: 'primary', size: 'compact' }, 'Go'),
    );
    expect(markup).toContain('piwin-button');
    expect(markup).toContain('piwin-button--primary');
    expect(markup).toContain('piwin-button--compact');
  });

  it('Button covers every variant class the stylesheet styles', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      const markup = renderWithProvider(createElement(Button, { variant }, variant));
      expect(markup).toContain(`piwin-button--${variant}`);
    }
  });

  it('IconButton exposes piwin-icon-button and keeps aria-pressed for the pressed state', () => {
    const markup = renderWithProvider(
      createElement(IconButton, { label: 'Toggle', 'aria-pressed': true }, 'x'),
    );
    expect(markup).toContain('piwin-icon-button');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('IconButton forwards a numeric size to ActionIcon', () => {
    const markup = renderWithProvider(
      createElement(IconButton, { label: 'Mute', size: 26 }, 'x'),
    );
    // Mantine stores numeric sizes as rem: 26px → 1.625rem.
    expect(markup).toContain('--ai-size:calc(1.625rem');
  });

  it('Field exposes ui-field structure classes and error slot', () => {
    const markup = renderToStaticMarkup(
      createElement(Field, {
        label: 'Name',
        error: 'Required',
        description: 'Desc',
        // Narrow to Field's control contract; exactOptionalPropertyTypes makes
        // the DOM InputHTMLAttributes shape (id?: string | undefined) otherwise
        // incompatible with FieldControlProps (id?: string).
        children: createElement('input', { id: 'contract-input' }) as ReactElement<{ id: string }>,
      }),
    );
    expect(markup).toContain('ui-field');
    expect(markup).toContain('ui-field-label');
    expect(markup).toContain('ui-field-control');
    expect(markup).toContain('ui-field-error');
    expect(markup).toContain('ui-field-description');
  });

  it('FieldCheckbox exposes ui-field-checkbox structure and data-disabled state hook', () => {
    const markup = renderToStaticMarkup(
      createElement(FieldCheckbox, {
        label: 'Flag',
        checked: false,
        disabled: true,
        onCheckedChange: () => undefined,
      }),
    );
    expect(markup).toContain('ui-field-checkbox');
    expect(markup).toContain('ui-field-checkbox-input');
    expect(markup).toContain('ui-field-checkbox-label');
    expect(markup).toContain('data-disabled="true"');
  });

  it('ListRow exposes piwin-list-row with is-selected / is-compact modifiers', () => {
    const markup = renderToStaticMarkup(
      createElement(ListRow, { selected: true, compact: true, children: 'Row' }),
    );
    expect(markup).toContain('piwin-list-row');
    expect(markup).toContain('is-selected');
    expect(markup).toContain('is-compact');
  });

  it('Surface exposes piwin-surface base plus tone modifier classes', () => {
    for (const tone of ['inset', 'raised', 'selected'] as const) {
      const markup = renderToStaticMarkup(
        createElement(Surface, { tone }, 'Body'),
      );
      expect(markup).toContain('piwin-surface');
      expect(markup).toContain(`piwin-surface--${tone}`);
    }
  });

  it('StatusBadge exposes ui-status-badge tone class and dot element', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge, { tone: 'running', label: 'Running' }),
    );
    expect(markup).toContain('ui-status-badge');
    expect(markup).toContain('tone-running');
    expect(markup).toContain('ui-status-dot');
  });

  it('Notice exposes ui-notice with tone modifier', () => {
    const markup = renderToStaticMarkup(
      createElement(Notice, { tone: 'error', children: 'Broken' }),
    );
    expect(markup).toContain('ui-notice');
    expect(markup).toContain('tone-error');
  });

  it('Spinner exposes ui-spinner', () => {
    const markup = renderToStaticMarkup(createElement(Spinner, {}));
    expect(markup).toContain('ui-spinner');
  });

  it('ProgressRing exposes ui-progress-ring and tone class', () => {
    const markup = renderToStaticMarkup(createElement(ProgressRing, { value: 50, tone: 'pine' }));
    expect(markup).toContain('ui-progress-ring');
    expect(markup).toContain('ui-progress-ring--pine');
    expect(markup).toContain('is-determinate');
  });

  it('Toast exposes ui-toast, tone modifier, seal, and body classes', () => {
    const markup = renderToStaticMarkup(
      createElement(Toast, { tone: 'success', title: 'Saved', children: 'All good' }),
    );
    expect(markup).toContain('ui-toast');
    expect(markup).toContain('tone-success');
    expect(markup).toContain('ui-toast-seal');
    expect(markup).toContain('ui-toast-title');
    expect(markup).toContain('ui-toast-message');
  });

  it('Toast stacks and offers a show-more control when multiline', () => {
    const markup = renderToStaticMarkup(
      createElement(Toast, {
        tone: 'error',
        title: 'Failed',
        multiline: true,
        expandLabel: 'Show more',
        collapseLabel: 'Show less',
        children: 'A very long failure explanation',
      }),
    );
    expect(markup).toContain('is-multiline');
    expect(markup).toContain('ui-toast-expand');
    expect(markup).toContain('Show more');
    expect(markup).not.toContain('ui-toast-sep');
  });

  it('NumberInput exposes piwin-number-input and shared text-input chrome classes', () => {
    const markup = renderWithProvider(
      createElement(NumberInput, {
        value: 1024,
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('piwin-number-input');
    expect(markup).toContain('piwin-text-input');
    expect(markup).toContain('piwin-number-input-field');
    expect(markup).toContain('piwin-text-input-field');
  });

  it('TextArea exposes piwin-text-area structure classes', () => {
    const markup = renderWithProvider(
      createElement(TextArea, {
        label: 'Notes',
        description: 'Hint',
        value: 'body',
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('piwin-text-area');
    expect(markup).toContain('piwin-text-area-label');
    expect(markup).toContain('piwin-text-area-field');
    expect(markup).toContain('piwin-text-area-description');
  });

  it('EmptyState exposes empty-state structure and styling classes', () => {
    const markup = renderWithProvider(
      createElement(EmptyState, {
        title: 'No results',
        description: 'Try adjusting query',
        seal: '寻',
        badge: '0 items',
        suggestions: [{ label: 'Reset' }],
        action: createElement('button', null, 'Clear'),
        secondaryAction: createElement('button', null, 'Help'),
        size: 'spacious',
        card: true,
      }),
    );
    expect(markup).toContain('empty-state');
    expect(markup).toContain('empty-state--spacious');
    expect(markup).toContain('empty-state--card');
    expect(markup).toContain('empty-state-visual');
    expect(markup).toContain('empty-state-seal');
    expect(markup).toContain('empty-state-badge');
    expect(markup).toContain('empty-state-title');
    expect(markup).toContain('empty-state-copy');
    expect(markup).toContain('empty-state-suggestions');
    expect(markup).toContain('empty-state-suggestion-chip');
    expect(markup).toContain('empty-state-actions');
    expect(markup).toContain('empty-state-action');
    expect(markup).toContain('empty-state-secondary-action');
  });
});
