// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStableHandlers } from './use-stable-handlers.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type Value = { ids: string[]; open: (id: string) => string } | null;

function Probe(props: { value: Value; seen: Value[] }): ReactElement {
  props.seen.push(useStableHandlers(props.value));
  return <span />;
}

describe('useStableHandlers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps one object while only handler identities change, and calls the latest', () => {
    const seen: Value[] = [];
    act(() => root.render(<Probe value={{ ids: ['a'], open: (id) => `first:${id}` }} seen={seen} />));
    act(() => root.render(<Probe value={{ ids: ['a'], open: (id) => `second:${id}` }} seen={seen} />));

    expect(seen[1]).toBe(seen[0]);
    expect(seen[1]?.open('x')).toBe('second:x');
  });

  it('hands out a new object when data changes, with the same handler proxy', () => {
    const seen: Value[] = [];
    const open = (id: string): string => id;
    act(() => root.render(<Probe value={{ ids: ['a'], open }} seen={seen} />));
    act(() => root.render(<Probe value={{ ids: ['a', 'b'], open }} seen={seen} />));

    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]?.ids).toEqual(['a', 'b']);
    expect(seen[1]?.open).toBe(seen[0]?.open);
  });

  it('passes null through', () => {
    const seen: Value[] = [];
    act(() => root.render(<Probe value={null} seen={seen} />));
    expect(seen[0]).toBeNull();
  });
});
