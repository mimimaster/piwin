// @vitest-environment happy-dom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SessionSearchDialog } from './session-search-dialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  container?.remove();
  container = null;
  document.body.querySelectorAll('[data-testid="session-search-dialog"]').forEach((node) => {
    node.remove();
  });
});

function renderDialog(onOpenSession = vi.fn()): typeof onOpenSession {
  container = document.createElement('div');
  document.body.appendChild(container);
  activeRoot = createRoot(container);

  function Harness(): ReactElement {
    const [open, setOpen] = useState(true);
    const [query, setQuery] = useState('');
    return (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SessionSearchDialog
          open={open}
          onOpenChange={setOpen}
          query={query}
          onQueryChange={setQuery}
          primaryScope={{ kind: 'project', projectPath: '/Users/test/piwin' }}
          primarySessions={[
            {
              id: 'recent',
              name: 'Recent agent',
              lastPreview: 'Recent agent',
              updatedAt: '2026-08-25T00:00:00.000Z',
            },
            {
              id: 'older',
              name: 'Older agent',
              updatedAt: '2026-08-20T00:00:00.000Z',
            },
          ]}
          generalSessions={[{ id: 'general', name: 'General notes' }]}
          recentProjects={[
            {
              path: '/Users/test/piwin',
              displayName: 'piwin',
              trust: 'trusted',
              lastOpenedAt: '2026-08-25T00:00:00.000Z',
              createdAt: '2026-08-20T00:00:00.000Z',
            },
          ]}
          locale="en"
          onOpenSession={onOpenSession}
        />
      </PiwinUiProvider>
    );
  }

  act(() => activeRoot?.render(<Harness />));
  return onOpenSession;
}

describe('SessionSearchDialog', () => {
  it('shows recent sessions and updates the controlled keyword query', () => {
    renderDialog();
    const input = document.querySelector<HTMLInputElement>('[data-testid="session-search-input"]');
    expect(input?.placeholder).toContain('Search session names');
    expect(document.body.textContent).toContain('Recent sessions');
    expect(document.body.textContent).toContain('Recent agent');

    act(() => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'agent');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input?.value).toBe('agent');
    expect(document.body.textContent).toContain('Search results');
    expect(
      document
        .querySelector('[data-session-id="recent"]')
        ?.querySelector('.session-search-result-snippet'),
    ).toBeNull();
  });

  it('opens the keyboard-selected result with its project scope', () => {
    const onOpenSession = renderDialog();
    const input = document.querySelector<HTMLInputElement>('[data-testid="session-search-input"]');

    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onOpenSession).toHaveBeenCalledWith('older', {
      kind: 'project',
      projectPath: '/Users/test/piwin',
    });
    expect(document.querySelector('[data-testid="session-search-dialog"]')).toBeNull();
  });
});
