// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useResetSettingsMainScroll } from './use-reset-settings-scroll.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function Harness(props: { resetKey: string }): ReactElement | null {
  useResetSettingsMainScroll(props.resetKey);
  return null;
}

describe('useResetSettingsMainScroll', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let main: HTMLDivElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    main = document.createElement('div');
    main.setAttribute('data-testid', 'settings-main-scroll');
    const content = document.createElement('div');
    content.className = 'settings-main-content';
    main.appendChild(content);
    document.body.appendChild(main);
    main.scrollTop = 120;
    content.scrollTop = 80;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    main?.remove();
    root = null;
    container = null;
    main = null;
  });

  it('clears settings main and content scroll when the hub tab key changes', () => {
    act(() => {
      root!.render(<Harness resetKey="appearance" />);
    });
    expect(main?.scrollTop).toBe(0);
    expect(main?.querySelector('.settings-main-content')?.scrollTop).toBe(0);

    main!.scrollTop = 90;
    const content = main!.querySelector('.settings-main-content');
    if (content instanceof HTMLElement) {
      content.scrollTop = 40;
    }

    act(() => {
      root!.render(<Harness resetKey="pets" />);
    });
    expect(main?.scrollTop).toBe(0);
    expect(main?.querySelector('.settings-main-content')?.scrollTop).toBe(0);
  });
});
