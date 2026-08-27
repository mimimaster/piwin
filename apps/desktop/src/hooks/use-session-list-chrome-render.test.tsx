// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useSessionListChrome } from './use-session-list-chrome';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

function Harness(): ReactElement {
  const chrome = useSessionListChrome();
  return (
    <>
      <button type="button" data-testid="open" onClick={chrome.openSessionSearch}>
        Open
      </button>
      <input
        data-testid="query"
        value={chrome.sessionSearch}
        onChange={(event) => chrome.setSessionSearch(event.target.value)}
      />
      <output data-testid="state">{chrome.sessionSearchOpen ? 'open' : 'closed'}</output>
      <button type="button" data-testid="close" onClick={() => chrome.setSessionSearchOpen(false)}>
        Close
      </button>
    </>
  );
}

describe('useSessionListChrome search surface', () => {
  it('opens the dialog and clears its controlled query when closed', () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Harness />));

    const open = container.querySelector<HTMLButtonElement>('[data-testid="open"]');
    const close = container.querySelector<HTMLButtonElement>('[data-testid="close"]');
    const query = container.querySelector<HTMLInputElement>('[data-testid="query"]');
    const state = container.querySelector<HTMLOutputElement>('[data-testid="state"]');

    act(() => open?.click());
    expect(state?.textContent).toBe('open');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(query, 'needle');
      query?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(query?.value).toBe('needle');

    act(() => close?.click());
    expect(state?.textContent).toBe('closed');
    expect(query?.value).toBe('');
    act(() => root.unmount());
  });
});
