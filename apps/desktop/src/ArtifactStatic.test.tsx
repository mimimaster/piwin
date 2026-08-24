/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolveArtifactViewportFrameHeight } from '@piwin/artifact';
import { ArtifactStatic } from './ArtifactStatic.js';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('ArtifactStatic', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders sanitized static markup in a naturally-sized Shadow DOM without an iframe', () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="html"
          source='<style>.card{padding:12px}</style><section class="card"><h1>Hello</h1></section>'
        />,
      );
    });

    const host = container.querySelector<HTMLElement>('[data-testid="artifact-static"]');
    expect(host?.shadowRoot?.querySelector('h1')?.textContent).toBe('Hello');
    expect(
      host?.shadowRoot?.querySelector('style:not([data-piwin-artifact-static-base])'),
    ).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(host?.style.height).toBe('');
  });

  it('removes executable markup as defense in depth', () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="html"
          source='<img src="data:image/png;base64,AA==" onerror="alert(1)"><script>alert(2)</script>'
        />,
      );
    });

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelector('script')).toBeNull();
    expect(shadow?.querySelector('[onerror]')).toBeNull();
  });

  it('does not wrap ordinary static content in an overflow shell', () => {
    act(() => {
      root.render(<ArtifactStatic type="html" source="<section>Short</section>" />);
    });
    expect(container.querySelector('[data-testid="artifact-static-overflow-shell"]')).toBeNull();
    expect(container.querySelector('[data-testid="artifact-overflow-hint"]')).toBeNull();
    const base = container
      .querySelector('[data-testid="artifact-static"]')
      ?.shadowRoot?.querySelector('style[data-piwin-artifact-static-base]');
    expect(base?.textContent).not.toContain('contain: paint');
  });

  it('puts super-tall static content in a visible overflow shell instead of paint-clipping', () => {
    const proto = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('piwin-artifact-root')) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 400,
          bottom: 20_000,
          width: 400,
          height: 20_000,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return proto.call(this);
    });

    act(() => {
      root.render(<ArtifactStatic type="html" source="<section>Tall</section>" />);
    });

    const shell = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static-overflow-shell"]',
    );
    const chrome = resolveArtifactViewportFrameHeight(window.innerHeight);
    expect(shell).not.toBeNull();
    expect(shell?.style.overflowY).toBe('auto');
    expect(shell?.style.maxHeight).toBe(`${chrome}px`);
    expect(shell?.getAttribute('tabindex')).toBe('0');
    const hint = shell?.querySelector('[data-testid="artifact-overflow-hint"]');
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.getAttribute('tabindex')).toBeNull();
    expect(hint?.textContent).toBe(artifactOverflowHintCopy('en'));
    const host = shell?.querySelector('[data-testid="artifact-static"]');
    const base = host?.shadowRoot?.querySelector('style[data-piwin-artifact-static-base]');
    expect(base?.textContent).not.toContain('contain: paint');
    expect(base?.textContent).toContain('overflow-y: visible');
  });
});
