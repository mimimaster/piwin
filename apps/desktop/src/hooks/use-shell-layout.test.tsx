// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useShellLayout } from './use-shell-layout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('opens the launcher through a generic toggle while retaining explicit tool requests', () => {
  let shell: ReturnType<typeof useShellLayout> | null = null;
  function Probe() { shell = useShellLayout(); return null; }
  const current = () => {
    if (shell === null) throw new Error('shell did not mount');
    return shell;
  };
  const root = createRoot(document.createElement('div'));
  try {
    act(() => { root.render(<Probe />); });
    act(() => { current().openInspector('browser'); });
    expect(current().inspectorTab).toBe('browser');
    act(() => { current().toggleInspector(); });
    act(() => { current().toggleInspector(); });
    expect(current().rightPanelOpen).toBe(true);
    expect(current().inspectorTab).toBeNull();
    act(() => { current().toggleInspector(); });
    act(() => { current().toggleInspector('files'); });
    expect(current().inspectorTab).toBe('files');
  } finally {
    act(() => { root.unmount(); });
  }
});

it('keeps shell object identity stable across unrelated parent re-renders', () => {
  const snapshots: Array<ReturnType<typeof useShellLayout>> = [];
  let triggerParentRerender: (() => void) | null = null;

  function Probe() {
    const [, setTick] = useState(0);
    triggerParentRerender = () => setTick((value) => value + 1);
    const shell = useShellLayout();
    snapshots.push(shell);
    return null;
  }

  const root = createRoot(document.createElement('div'));
  try {
    act(() => {
      root.render(<Probe />);
    });
    act(() => {
      triggerParentRerender?.();
    });
    act(() => {
      triggerParentRerender?.();
    });
    expect(snapshots).toHaveLength(3);
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);
  } finally {
    act(() => {
      root.unmount();
    });
  }
});
