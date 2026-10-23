// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkbenchTui } from './workbench-tui';

let container: HTMLDivElement;
let root: Root;
let controls: ReturnType<typeof useWorkbenchTui> | undefined;
function Harness(props: Parameters<typeof useWorkbenchTui>[0]) {
  controls = useWorkbenchTui(props);
  return <div data-active={controls.active} />;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); controls = undefined; });
function render(sessionId: string | null = null, available = true, scopeKey = 'general', hostKey = 'host-1') {
  act(() => root.render(<Harness sessionId={sessionId} available={available} scopeKey={scopeKey} hostKey={hostKey} />));
}

describe('conversation shell selection', () => {
  it('starts on the homepage even with a retired stored TUI preference', () => {
    localStorage.setItem('piwin.desktop.conversation-surface', 'tui');
    render();
    expect(controls?.active).toBe(false);
    act(() => controls?.open());
    expect(controls?.active).toBe(true);
    act(() => controls?.close());
    expect(controls?.active).toBe(false);
    localStorage.removeItem('piwin.desktop.conversation-surface');
  });
  it('keeps the selected surface when a TUI session is adopted and returns home for a new conversation', () => {
    render();
    act(() => controls?.open());
    render('tui-created');
    expect(controls?.active).toBe(true);
    render();
    expect(controls?.active).toBe(false);
  });
  it('keeps a newly adopted Grok terminal when its No Repo project scope is hydrated', () => {
    render();
    act(() => { controls?.open(); controls?.adopt('new-grok'); });
    render('new-grok');
    expect(controls?.active).toBe(true);
    render('new-grok', true, 'no-repo');
    expect(controls?.active).toBe(true);
    render('new-grok', true, 'no-repo', 'host-2');
    expect(controls?.active).toBe(false);
  });
  it('clears terminal selection on disable, Host change or project-scope change', () => {
    render();
    act(() => controls?.open());
    render(null, false);
    expect(controls?.active).toBe(false);
    render();
    expect(controls?.active).toBe(false);
    act(() => controls?.open());
    render(null, true, '/work/new-project');
    expect(controls?.active).toBe(false);
  });
});

it('retains only the current terminal on Desktop and releases it on navigation/reset', () => {
  render('first');
  expect(controls?.mounted).toBe(false);
  act(() => controls?.open());
  act(() => controls?.close());
  expect(controls?.active).toBe(false);
  expect(controls?.mounted).toBe(true);
  act(() => controls?.open());
  expect(controls?.mounted).toBe(true);
  act(() => controls?.close());
  render('second');
  expect(controls?.mounted).toBe(false);
  act(() => controls?.open());
  act(() => controls?.reset());
  expect(controls?.mounted).toBe(false);
});
