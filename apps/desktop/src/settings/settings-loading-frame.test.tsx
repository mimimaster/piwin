// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, lazy, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { DeferredSurfaceBoundary } from '../conversation/deferred-desktop-surfaces';
import { SettingsLoadingFrame } from './settings-loading-frame';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A chunk that never arrives during the test. */
const NeverLoads = lazy(() => new Promise<{ default: () => ReactElement }>(() => undefined));

describe('SettingsLoadingFrame', () => {
  it('stands in for the settings chunk with the page frame, not a bare spinner', () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DeferredSurfaceBoundary
            label="Loading settings"
            fallback={<SettingsLoadingFrame locale="zh-CN" onClose={onClose} />}
          >
            <NeverLoads />
          </DeferredSurfaceBoundary>
        </PiwinUiProvider>,
      ),
    );
    const frame = host.querySelector('[data-testid="settings-loading-frame"]');
    expect(frame?.textContent).toContain('设置');
    expect(host.querySelector('[data-testid="deferred-surface-fallback"]')).toBeNull();
    act(() => frame?.querySelector('button')?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the spinner fallback for surfaces that bring no frame', () => {
    act(() =>
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DeferredSurfaceBoundary label="Loading notes">
            <NeverLoads />
          </DeferredSurfaceBoundary>
        </PiwinUiProvider>,
      ),
    );
    expect(host.querySelector('[data-testid="deferred-surface-fallback"]')).not.toBeNull();
  });
});
