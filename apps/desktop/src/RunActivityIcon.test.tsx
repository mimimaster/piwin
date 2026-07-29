// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivityIcon } from './RunActivityIcon.js';
import type { ActivityIconSource } from './run-activity-types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { source: ActivityIconSource }): ReactElement {
  return <RunActivityIcon source={props.source} data-testid="icon" />;
}

describe('RunActivityIcon', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
  });

  it('renders an img when imgSrc is provided', () => {
    const source: ActivityIconSource = { kind: 'waiting-first-token', lucideName: 'Sparkles', imgSrc: '/ui/test.png' };
    act(() => root.render(<TestHarness source={source} />));
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/ui/test.png');
  });

  it('renders an svg when no imgSrc', () => {
    const source: ActivityIconSource = { kind: 'working', lucideName: 'Code' };
    act(() => root.render(<TestHarness source={source} />));
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to an svg when the generated image fails to load', () => {
    const source: ActivityIconSource = {
      kind: 'waiting-first-token',
      lucideName: 'Sparkles',
      imgSrc: '/ui/missing.png',
    };
    act(() => root.render(<TestHarness source={source} />));
    const img = container.querySelector<HTMLImageElement>('img');
    if (!img) {
      throw new Error('Expected generated icon image');
    }
    act(() => img.dispatchEvent(new Event('error')));
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
