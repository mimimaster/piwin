// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NavRail, type NavRailProps } from './nav-rail';

function renderRail(props: Partial<NavRailProps>): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const allProps: NavRailProps = {
    locale: 'en',
    activeSubPage: null,
    settingsOpen: false,
    onNavigateChat: () => undefined,
    onOpenLibrary: () => undefined,
    onOpenFlashcards: () => undefined,
    onOpenSessionSearch: () => undefined,
    onOpenSettings: () => undefined,
    ...props,
  };
  act(() => {
    root.render(<NavRail {...allProps} />);
  });
  return { container, root };
}

describe('NavRail', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks chat active when no subpage is open', () => {
    const { container } = renderRail({ activeSubPage: null });
    const chat = container.querySelector('[data-testid="nav-rail-chat-btn"]');
    expect(chat?.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-testid="nav-rail-library-btn"]')?.classList.contains('active')).toBe(false);
  });

  it('marks library active for library / images / videos subpages', () => {
    for (const subPage of ['library', 'images', 'videos'] as const) {
      const { container } = renderRail({ activeSubPage: subPage });
      expect(
        container.querySelector('[data-testid="nav-rail-library-btn"]')?.classList.contains('active'),
      ).toBe(true);
    }
  });

  it('marks flashcards active for the flashcards subpage only', () => {
    const { container } = renderRail({ activeSubPage: 'flashcards' });
    expect(container.querySelector('[data-testid="nav-rail-flashcards-btn"]')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-testid="nav-rail-chat-btn"]')?.classList.contains('active')).toBe(false);
  });

  it('marks settings active + aria-pressed when settings are open', () => {
    const { container } = renderRail({ settingsOpen: true });
    const settings = container.querySelector<HTMLButtonElement>('[data-testid="nav-rail-settings-btn"]');
    expect(settings?.classList.contains('active')).toBe(true);
    expect(settings?.getAttribute('aria-pressed')).toBe('true');
  });

  it('fires each destination handler', () => {
    const handlers: Record<string, ReturnType<typeof vi.fn>> = {
      onNavigateChat: vi.fn(),
      onOpenLibrary: vi.fn(),
      onOpenFlashcards: vi.fn(),
      onOpenSessionSearch: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { container } = renderRail(handlers);
    const byTestId: Array<[string, string]> = [
      ['nav-rail-chat-btn', 'onNavigateChat'],
      ['nav-rail-library-btn', 'onOpenLibrary'],
      ['nav-rail-flashcards-btn', 'onOpenFlashcards'],
      ['nav-rail-search-btn', 'onOpenSessionSearch'],
      ['nav-rail-settings-btn', 'onOpenSettings'],
    ];
    for (const [testId, handler] of byTestId) {
      const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
      act(() => {
        btn?.click();
      });
      expect(handlers[handler]).toHaveBeenCalledTimes(1);
    }
  });
});
