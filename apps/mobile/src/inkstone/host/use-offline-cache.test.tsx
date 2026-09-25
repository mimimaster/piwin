// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDraft } from '../../hooks/mobile-offline-cache.js';
import { fakeHost } from '../test-host-fixture.js';
import type { InkstoneHost } from './inkstone-host-context.js';
import { useSessionDrafts } from './use-offline-cache.js';

const ENDPOINT = 'ws://127.0.0.1:8787';

interface DraftHarness {
  select: (sessionId: string) => void;
  type: (text: string) => void;
  text: () => string;
}

function renderDrafts(root: Root): DraftHarness {
  const harness: Partial<DraftHarness> = {};
  let current = '';
  function Probe(): null {
    const [activeSessionId, setActive] = useState<string | undefined>('s1');
    const [composerText, setComposerText] = useState('');
    const host: InkstoneHost = fakeHost({ endpoint: ENDPOINT, activeSessionId, composerText, setComposerText });
    useSessionDrafts(host);
    current = composerText;
    harness.select = (sessionId) => act(() => setActive(sessionId));
    harness.type = (text) => act(() => setComposerText(text));
    return null;
  }
  act(() => root.render(<Probe />));
  harness.text = () => current;
  return harness as DraftHarness;
}

let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.useFakeTimers();
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('useSessionDrafts', () => {
  it('keeps each session its own draft across switches', () => {
    const drafts = renderDrafts(root as Root);
    drafts.type('写给 s1 的一半');
    drafts.select('s2');
    expect(drafts.text()).toBe('');
    drafts.type('s2 的草稿');
    drafts.select('s1');
    expect(drafts.text()).toBe('写给 s1 的一半');
    drafts.select('s2');
    expect(drafts.text()).toBe('s2 的草稿');
  });

  it('persists typing after a short pause and forgets sent drafts', () => {
    const drafts = renderDrafts(root as Root);
    drafts.type('还没发');
    act(() => vi.advanceTimersByTime(500));
    expect(readDraft(localStorage, ENDPOINT, 's1')).toBe('还没发');
    drafts.type('');
    act(() => vi.advanceTimersByTime(500));
    expect(readDraft(localStorage, ENDPOINT, 's1')).toBe('');
  });
});
