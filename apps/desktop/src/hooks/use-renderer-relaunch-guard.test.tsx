// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareRendererRelaunch,
  BEFORE_RENDERER_RELAUNCH_EVENT,
} from '../platform/renderer-relaunch-preparation.js';
import { useRendererRelaunchGuard } from './use-renderer-relaunch-guard.js';
import { useComposerDraftLifecycle } from './use-composer-draft-lifecycle.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('renderer relaunch owner guards', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('reads the latest protection state and removes the veto on unmount', () => {
    root = createRoot(document.createElement('div'));
    function Guard({ blocked }: { blocked: boolean }) {
      useRendererRelaunchGuard(blocked);
      return null;
    }
    act(() => root?.render(<Guard blocked={false} />));
    expect(prepareRendererRelaunch()).toBe(true);
    act(() => root?.render(<Guard blocked />));
    expect(prepareRendererRelaunch()).toBe(false);
    act(() => root?.render(<Guard blocked={false} />));
    expect(prepareRendererRelaunch()).toBe(true);
    act(() => root?.unmount());
    root = null;
    expect(prepareRendererRelaunch()).toBe(true);
  });

  it('keeps flush listeners running when another owner vetoes', () => {
    const flush = vi.fn();
    root = createRoot(document.createElement('div'));
    function Guard() {
      useRendererRelaunchGuard(true);
      return null;
    }
    act(() => root?.render(<Guard />));
    window.addEventListener(BEFORE_RENDERER_RELAUNCH_EVENT, flush);
    try {
      expect(prepareRendererRelaunch()).toBe(false);
      expect(flush).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(BEFORE_RENDERER_RELAUNCH_EVENT, flush);
    }
  });

  it('flushes parked drafts synchronously and vetoes a failed or lossy save', () => {
    const persist = vi.fn(() => true);
    const persistTimerRef = { current: null };
    root = createRoot(document.createElement('div'));
    function Drafts({ canRelaunch }: { canRelaunch: boolean }) {
      useComposerDraftLifecycle({ persist, persistTimerRef, canRelaunch: () => canRelaunch });
      return null;
    }
    act(() => root?.render(<Drafts canRelaunch />));
    expect(prepareRendererRelaunch()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
    persist.mockReturnValue(false);
    expect(prepareRendererRelaunch()).toBe(false);
    persist.mockClear();
    act(() => root?.render(<Drafts canRelaunch={false} />));
    expect(prepareRendererRelaunch()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});
