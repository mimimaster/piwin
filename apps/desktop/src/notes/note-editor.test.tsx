// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { prepareRendererRelaunch } from '../platform/renderer-relaunch-preparation.js';
import { NoteEditor } from './note-editor.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('keeps an edited or saving note intact during renderer reclamation', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    initialTitle: 'Note',
    initialContent: 'body',
    busy: false,
    isZh: false,
    onSave: vi.fn(),
    onCancel: vi.fn(),
  };
  const renderEditor = (input: typeof props): void => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <NoteEditor {...input} />
      </PiwinUiProvider>,
    );
  };
  try {
    act(() => renderEditor(props));
    expect(prepareRendererRelaunch()).toBe(true);
    const title = container.querySelector<HTMLInputElement>(
      'input[data-testid="notes-editor-title"]',
    );
    if (!title) throw new Error('note title input missing');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(title, 'Edited note');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      title.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(prepareRendererRelaunch()).toBe(false);
    act(() => renderEditor({ ...props, initialTitle: 'Edited note', busy: true }));
    expect(prepareRendererRelaunch()).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
  expect(prepareRendererRelaunch()).toBe(true);
});
