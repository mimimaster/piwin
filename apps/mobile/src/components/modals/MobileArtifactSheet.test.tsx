// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MobileArtifactSheet } from './MobileArtifactSheet.js';
import { MOBILE_THEME } from '../../mobile-theme.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('MobileArtifactSheet', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders MobileArtifactSheet with sandboxed iframe', () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileArtifactSheet
            isOpen={true}
            onClose={onClose}
            title="Landing Page Demo"
            srcdoc="<h1>Hello Artifact</h1>"
          />
        </PiwinUiProvider>,
      );
    });

    expect(document.body.textContent).toContain('Landing Page Demo');
    const iframe = document.body.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

});
