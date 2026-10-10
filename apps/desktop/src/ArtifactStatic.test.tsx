/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolveArtifactViewportFrameHeight } from '@piwin/artifact';
import { ArtifactStatic } from './ArtifactStatic.js';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';
import { sanitizeStaticArtifactSource } from './artifact-static-sanitizer.js';

async function flushArtifactEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('ArtifactStatic', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(async () => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await sanitizeStaticArtifactSource('<p>warm</p>');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('carries its content in the first commit once the sanitizer is loaded', () => {
    // No awaited effect flush: a first frame without content is a frame in
    // which the transcript below jumps up by the Artifact's whole height.
    act(() => {
      root.render(<ArtifactStatic type="html" source="<section><h1>Ready</h1></section>" />);
    });
    const host = container.querySelector<HTMLElement>('[data-testid="artifact-static"]');
    expect(host?.shadowRoot?.querySelector('h1')?.textContent).toBe('Ready');

    act(() => {
      root.render(<ArtifactStatic type="html" source="<section><h1>Next</h1></section>" />);
    });
    expect(host?.shadowRoot?.querySelector('h1')?.textContent).toBe('Next');
  });

  it('still strips scripts and handlers on the immediate path', () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="html"
          source={'<section><p onclick="steal()">text</p></section><script>steal()</script>'}
        />,
      );
    });
    const shadow = container.querySelector<HTMLElement>('[data-testid="artifact-static"]')?.shadowRoot;
    const content = shadow?.querySelector('.piwin-artifact-root');
    expect(content?.textContent).toContain('text');
    expect(content?.innerHTML).not.toContain('steal');
    expect(shadow?.querySelector('script')).toBeNull();
  });

  it('never leaves the sanitizer wrapper in the rendered markup', () => {
    act(() => {
      root.render(<ArtifactStatic type="html" source="<p>one</p><p>two</p>" />);
    });
    const content = container
      .querySelector<HTMLElement>('[data-testid="artifact-static"]')
      ?.shadowRoot?.querySelector('.piwin-artifact-root');
    expect(content?.innerHTML).toBe('<p>one</p><p>two</p>');
  });

  it('styles a Report Kit document the way the sandbox does, at the Inline measure', () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="html"
          source={'<main class="piwin-report"><h1>Report</h1><span class="piwin-badge">ok</span></main>'}
        />,
      );
    });
    const shadow = container.querySelector<HTMLElement>('[data-testid="artifact-static"]')?.shadowRoot;
    const css = shadow?.querySelector('style')?.textContent ?? '';
    expect(css).toContain(':where(.piwin-report) :where(.piwin-badge)');
    expect(css).toContain('.piwin-artifact-root > .piwin-report');
    expect(shadow?.querySelector('.piwin-artifact-root')?.innerHTML).toBe(
      '<main class="piwin-report"><h1>Report</h1><span class="piwin-badge">ok</span></main>',
    );
  });

  it('renders sanitized static markup in a naturally-sized Shadow DOM without an iframe', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="html"
          source='<style>.card{padding:12px}</style><section class="card"><h1>Hello</h1></section>'
        />,
      );
    });
    await flushArtifactEffects();

    const host = container.querySelector<HTMLElement>('[data-testid="artifact-static"]');
    expect(host?.shadowRoot?.querySelector('h1')?.textContent).toBe('Hello');
    expect(
      host?.shadowRoot?.querySelector('style:not([data-piwin-artifact-static-base])'),
    ).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(host?.style.height).toBe('');
  });

  it('removes executable markup as defense in depth', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="html"
          source='<img src="data:image/png;base64,AA==" onerror="alert(1)"><script>alert(2)</script>'
        />,
      );
    });
    await flushArtifactEffects();

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelector('script')).toBeNull();
    expect(shadow?.querySelector('[onerror]')).toBeNull();
  });

  it('materializes defs wheel groups referenced by local use, matching the pelican SVG', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="svg"
          source={[
            '<svg viewBox="0 0 400 220">',
            '<defs><g id="spokedWheel">',
            '<circle r="36" fill="none" stroke="#222" />',
            '<circle r="6" />',
            '</g></defs>',
            '<g class="rear-wheel" transform="translate(-135, 150)"><use href="#spokedWheel"/></g>',
            '<g class="front-wheel" transform="translate(175, 150)"><use href="#spokedWheel"/></g>',
            '</svg>',
          ].join('')}
        />,
      );
    });
    await flushArtifactEffects();

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelector('use')).toBeNull();
    expect(shadow?.querySelector('.rear-wheel circle')).not.toBeNull();
    expect(shadow?.querySelector('.front-wheel circle')).not.toBeNull();
    expect(shadow?.querySelectorAll('.rear-wheel circle, .front-wheel circle').length).toBe(4);
  });

  it('expands safe local SVG use instances for WebKit Shadow DOM rendering', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="svg"
          source={[
            '<svg viewBox="0 0 240 120">',
            '<defs><g id="wheel"><circle r="40" /></g></defs>',
            '<use class="rear-wheel" href="#wheel" transform="translate(60 60)" />',
            '<use class="front-wheel" xlink:href="#wheel" transform="translate(180 60)" />',
            '</svg>',
          ].join('')}
        />,
      );
    });
    await flushArtifactEffects();

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelector('use')).toBeNull();
    expect(shadow?.querySelector('.rear-wheel > g > circle')).not.toBeNull();
    expect(shadow?.querySelector('.front-wheel > g > circle')).not.toBeNull();
    expect(shadow?.querySelector('.rear-wheel')?.getAttribute('transform')).toBe(
      'translate(60 60)',
    );
  });

  it('does not expand an external SVG use reference', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="svg"
          source='<svg><defs><g id="wheel"><circle r="40" /></g></defs><use href="https://example.com/wheel.svg#wheel" /></svg>'
        />,
      );
    });
    await flushArtifactEffects();

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelectorAll('circle')).toHaveLength(1);
  });

  it('drops percentage height on viewBox SVGs so transcript cards keep aspect ratio', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="svg"
          source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 650" width="100%" height="100%"><circle r="10" /></svg>'
        />,
      );
    });
    await flushArtifactEffects();

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    const svg = shadow?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('height') ?? null).toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 900 650');
  });

  it('expands pelican-style wheels nested under transformed groups', async () => {
    act(() => {
      root.render(
        <ArtifactStatic
          type="svg"
          source={[
            '<svg viewBox="0 0 600 450" width="100%" height="100%">',
            '<defs><g id="spokedWheel"><circle r="40" class="rim" /><circle r="6" class="hub" /></g></defs>',
            '<g class="rear" transform="translate(-135, 150)"><use href="#spokedWheel"/></g>',
            '<g class="front" transform="translate(175, 150)"><use href="#spokedWheel"/></g>',
            '</svg>',
          ].join('')}
        />,
      );
    });
    await flushArtifactEffects();

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelector('use')).toBeNull();
    expect(shadow?.querySelector('.rear .rim')).not.toBeNull();
    expect(shadow?.querySelector('.front .rim')).not.toBeNull();
    expect(shadow?.querySelector('svg')?.getAttribute('height') ?? null).toBeNull();
  });

  it('does not wrap ordinary static content in an overflow shell', async () => {
    act(() => {
      root.render(<ArtifactStatic type="html" source="<section>Short</section>" />);
    });
    await flushArtifactEffects();
    expect(container.querySelector('[data-testid="artifact-static-overflow-shell"]')).toBeNull();
    expect(container.querySelector('[data-testid="artifact-overflow-hint"]')).toBeNull();
    const base = container
      .querySelector('[data-testid="artifact-static"]')
      ?.shadowRoot?.querySelector('style[data-piwin-artifact-static-base]');
    expect(base?.textContent).not.toContain('contain: paint');
  });

  it('puts super-tall static content in a visible overflow shell instead of paint-clipping', async () => {
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
    await flushArtifactEffects();

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
