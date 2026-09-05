// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MOBILE_THEME } from '../mobile-theme.js';
import { InkstoneApp } from './InkstoneApp.js';

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function renderApp(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <PiwinUiProvider manifest={MOBILE_THEME}>
        <InkstoneApp hostContext={null} />
      </PiwinUiProvider>,
    );
  });
}

afterEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  window.location.hash = '';
});

describe('InkstoneApp smoke', () => {
  it('renders the sessions screen with continue card and bottom nav', () => {
    renderApp();
    expect(document.querySelector('.phone[data-route="sessions"]')).not.toBeNull();
    expect(document.body.textContent).toContain('从桌面继续');
    expect(document.body.textContent).toContain('书房的 Mac Studio');
    expect(document.querySelectorAll('.bottom-nav button').length).toBe(3);
  });

  it('opens the chat through the continue card and shows the composer', () => {
    renderApp();
    const continueButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('接着看'),
    );
    expect(continueButton).toBeDefined();
    act(() => {
      continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.phone[data-route="chat"]')).not.toBeNull();
    expect(document.querySelector('.composer textarea')).not.toBeNull();
  });

  it('opens and closes the model bottom sheet', () => {
    renderApp();
    act(() => {
      window.history.pushState(null, '', '#chat');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const modelButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Claude Sonnet'),
    );
    expect(modelButton).toBeDefined();
    act(() => {
      modelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector<HTMLDialogElement>('dialog.inkstone-sheet')?.open).toBe(true);
    expect(document.querySelector('.sheet-head h2')?.textContent).toBe('模型与思考');

    const closeButton = [...document.querySelectorAll('dialog button')].find((button) =>
      button.getAttribute('aria-label')?.includes('关闭弹层'),
    );
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector<HTMLDialogElement>('dialog.inkstone-sheet')?.open).toBe(false);
  });
});
