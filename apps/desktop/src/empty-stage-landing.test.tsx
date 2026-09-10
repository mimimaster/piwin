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

  it('still renders the welcome chrome when there is no history to resume', () => {
    const container = renderLanding([]);
    expect(container.querySelector('[data-testid="empty-stage-landing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="empty-stage-landing-row"]')).toBeNull();
    expect(container.querySelector('[data-testid="empty-stage-inkstone-seal"]')).not.toBeNull();
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

  it('renders the Inkstone seal next to the welcome heading', () => {
    const container = renderLanding([session({ id: 'abc', name: 'Notes' })]);
    expect(container.querySelector('[data-testid="empty-stage-inkstone-seal"]')).not.toBeNull();
    expect(container.textContent).toContain('砚');
  });

  it('renders the "研墨起笔" heading in Chinese and "Begin with Ink" in English', () => {
    const zhContainer = document.createElement('div');
    document.body.appendChild(zhContainer);
    const zhRoot = createRoot(zhContainer);
    mountedRoots.push({ root: zhRoot, container: zhContainer });
    act(() => {
      zhRoot.render(
        <EmptyStageLanding
          locale="zh-CN"
          sessions={[session({ id: 'abc', name: 'Notes' })]}
          onResumeSession={() => {}}
        />,
      );
    });
    expect(zhContainer.querySelector('h1')?.textContent).toBe('研墨起笔');

    const enContainer = renderLanding([session({ id: 'abc', name: 'Notes' })]);
    expect(enContainer.querySelector('h1')?.textContent).toBe('Begin with Ink');
  });

  it('renders the recent section header with divider and all-sessions button', () => {
    const onOpenAll = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
      root.render(
        <EmptyStageLanding
          locale="zh-CN"
          sessions={[
            session({ id: '1', name: 'S1' }),
            session({ id: '2', name: 'S2' }),
          ]}
          onResumeSession={() => {}}
          onOpenAllSessions={onOpenAll}
        />,
      );
    });

    const header = container.querySelector('.empty-stage-landing-header');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('最近');
    expect(header?.textContent).toContain('全部 2 →');

    const allButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="empty-stage-landing-all"]',
    );
    expect(allButton).not.toBeNull();
    act(() => {
      allButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenAll).toHaveBeenCalledOnce();
  });

  it('renders a running status dot for active sessions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
      root.render(
        <EmptyStageLanding
          locale="zh-CN"
          sessions={[
            session({
              id: 's-running',
              name: 'Running task',
              updatedAt: '2026-09-02T10:00:00.000Z',
            }),
            session({
              id: 's-idle',
              name: 'Idle task',
              updatedAt: '2026-09-01T10:00:00.000Z',
            }),
          ]}
          onResumeSession={() => {}}
          runningSessionIds={{ 's-running': true }}
        />,
      );
    });

    const rows = container.querySelectorAll('[data-testid="empty-stage-landing-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.empty-stage-landing-dot.is-running')).not.toBeNull();
    expect(rows[1]?.querySelector('.empty-stage-landing-dot.is-running')).toBeNull();
  });
});
