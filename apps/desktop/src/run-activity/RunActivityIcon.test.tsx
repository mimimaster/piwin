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

  it('renders a Lucide svg', () => {
    const source: ActivityIconSource = { kind: 'working', lucideName: 'Code' };
    act(() => root.render(<TestHarness source={source} />));
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses Loader2 for an unknown Lucide name', () => {
    const source: ActivityIconSource = { kind: 'waiting-first-token', lucideName: 'Unknown' };
    act(() => root.render(<TestHarness source={source} />));
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('data-testid')).toBe('icon');
  });
});
