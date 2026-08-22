/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactPreviewDecision } from '@piwin/artifact';
import { ArtifactStatic } from './ArtifactStatic.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function decision(source: string): Extract<ArtifactPreviewDecision, { kind: 'render' }> {
  return {
    kind: 'render',
    mode: 'interactive',
    descriptor: {
      id: 'static-artifact-test',
      type: 'html',
      title: 'Static Artifact',
      source,
      rawLanguage: 'artifact-html',
      alias: 'artifact-html',
      declaration: 'explicit',
      documentKind: 'fragment',
      surface: 'inline',
    },
    security: {
      canRender: true,
      blockReason: null,
      byteSize: source.length,
      externalResources: [],
    },
    srcdoc: '',
    csp: "default-src 'none'",
    renderSource: source,
    themeRepairs: [],
  };
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
          decision={decision(
            '<style>.card{padding:12px}</style><section class="card"><h1>Hello</h1></section>',
          )}
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
          decision={decision(
            '<img src="data:image/png;base64,AA==" onerror="alert(1)"><script>alert(2)</script>',
          )}
        />,
      );
    });

    const shadow = container.querySelector<HTMLElement>(
      '[data-testid="artifact-static"]',
    )?.shadowRoot;
    expect(shadow?.querySelector('script')).toBeNull();
    expect(shadow?.querySelector('[onerror]')).toBeNull();
  });
});
