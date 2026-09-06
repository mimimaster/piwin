// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionListItemUi } from './chat-ui-types';
import { EmptyStageLanding, selectResumableSessions } from './empty-stage-landing';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function session(overrides: Partial<SessionListItemUi> & { id: string }): SessionListItemUi {
  return {
    name: `session ${overrides.id}`,
    messageCount: 2,
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('selectResumableSessions', () => {
  it('orders newest first', () => {
    const selected = selectResumableSessions([
      session({ id: 'older', updatedAt: '2026-09-01T08:00:00.000Z' }),
      session({ id: 'newest', updatedAt: '2026-09-03T09:00:00.000Z' }),
      session({ id: 'middle', updatedAt: '2026-09-02T09:00:00.000Z' }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(['newest', 'middle', 'older']);
  });

  it('drops sessions with no turns or content so an empty draft is never offered', () => {
    const selected = selectResumableSessions([
      session({ id: 'empty', messageCount: 0, name: 'Untitled session' }),
      session({ id: 'missing-count', messageCount: 0, name: '' }),
      session({ id: 'has-turns', messageCount: 1, updatedAt: '2026-09-01T10:00:00.000Z' }),
      session({ id: 'named', messageCount: 0, name: 'TEST', updatedAt: '2026-09-02T10:00:00.000Z' }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(['named', 'has-turns']);
  });

  it('drops archived sessions', () => {
    const selected = selectResumableSessions([
      session({ id: 'archived', isArchived: true }),
      session({ id: 'active' }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(['active']);
  });

  it('caps the list so the composer keeps the visual weight', () => {
    const many = Array.from({ length: 9 }, (_unused, index) =>
      session({ id: `s${index}`, updatedAt: `2026-09-0${index + 1}T09:00:00.000Z` }),
    );
    expect(selectResumableSessions(many)).toHaveLength(4);
  });
});

describe('EmptyStageLanding', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mounted of mountedRoots.splice(0)) {
      act(() => mounted.root.unmount());
      mounted.container.remove();
    }
    document.body.replaceChildren();
  });

  function renderLanding(
    sessions: readonly SessionListItemUi[],
    onResumeSession: (sessionId: string) => void = () => {},
  ): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
      root.render(
        <EmptyStageLanding
          locale="en"
          sessions={sessions}
          onResumeSession={onResumeSession}
        />,
      );
    });
    return container;
  }

  it('renders nothing when there is no history to resume', () => {
    const container = renderLanding([]);
    expect(container.querySelector('[data-testid="empty-stage-landing"]')).toBeNull();
  });

  it('resumes the clicked session', () => {
    const onResumeSession = vi.fn();
    const container = renderLanding(
      [session({ id: 'abc', name: 'Docker notes' })],
      onResumeSession,
    );

    const row = container.querySelector<HTMLButtonElement>(
      '[data-testid="empty-stage-landing-row"]',
    );
    expect(row?.textContent).toContain('Docker notes');
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onResumeSession).toHaveBeenCalledWith('abc');
  });

  it('falls back to a placeholder title for an unnamed session', () => {
    const container = renderLanding([session({ id: 'blank', name: '   ', messageCount: 1 })]);
    expect(container.textContent).toContain('Untitled session');
  });

  it('does not render the removed Inkstone seal vignette', () => {
    const container = renderLanding([session({ id: 'abc', name: 'Notes' })]);
    expect(container.querySelector('[data-testid="empty-stage-inkstone-seal"]')).toBeNull();
    expect(container.textContent).not.toContain('砚');
  });
});
