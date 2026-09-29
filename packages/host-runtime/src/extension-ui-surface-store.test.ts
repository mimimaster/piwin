import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTENSION_UI_SURFACE_LIMITS, ExtensionUiSurfaceStore } from './extension-ui-surface-store.js';

describe('ExtensionUiSurfaceStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid status changes into one full snapshot push', () => {
    const push = vi.fn();
    const store = new ExtensionUiSurfaceStore({ push, coalesceMs: 50 });
    for (let tokens = 1; tokens <= 20; tokens += 1) {
      store.apply('s1', { kind: 'status', key: 'tokens', text: `${tokens} tok` });
    }
    store.apply('s1', {
      kind: 'widget',
      key: 'todo',
      lines: ['- one'],
      placement: 'belowEditor',
    });
    expect(push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      type: 'extension/ui_surface',
      snapshot: {
        sessionId: 's1',
        statuses: [{ key: 'tokens', text: '20 tok' }],
        widgets: [{ key: 'todo', lines: ['- one'], placement: 'belowEditor' }],
      },
    });
  });

  it('pushes notices immediately and never stores them', () => {
    const push = vi.fn();
    const store = new ExtensionUiSurfaceStore({ push });
    store.apply('s1', { kind: 'notify', message: 'Indexed 42 files', level: 'info' });
    store.apply('s1', { kind: 'notify', message: '   ', level: 'info' });
    expect(push.mock.calls).toEqual([
      [{ type: 'extension/ui_notice', sessionId: 's1', message: 'Indexed 42 files', level: 'info' }],
    ]);
    expect(store.snapshot('s1')).toEqual({ sessionId: 's1', statuses: [], widgets: [] });
  });

  it('does not push when nothing visible changed', () => {
    const push = vi.fn();
    const store = new ExtensionUiSurfaceStore({ push });
    store.apply('s1', { kind: 'status', key: 'git', text: 'main' });
    vi.runAllTimers();
    push.mockClear();
    store.apply('s1', { kind: 'status', key: 'git', text: 'main' });
    store.apply('s1', { kind: 'status', key: 'missing' });
    vi.runAllTimers();
    expect(push).not.toHaveBeenCalled();
  });

  it('caps keys, lines and item counts', () => {
    const store = new ExtensionUiSurfaceStore({ push: vi.fn() });
    for (let index = 0; index < EXTENSION_UI_SURFACE_LIMITS.maxStatuses + 5; index += 1) {
      store.apply('s1', { kind: 'status', key: `k${index}`, text: 'x' });
    }
    store.apply('s1', {
      kind: 'widget',
      key: 'log',
      lines: Array.from({ length: 100 }, () => 'y'.repeat(1000)),
      placement: 'aboveEditor',
    });
    const snapshot = store.snapshot('s1');
    expect(snapshot.statuses).toHaveLength(EXTENSION_UI_SURFACE_LIMITS.maxStatuses);
    const widget = snapshot.widgets[0];
    expect(widget?.lines).toHaveLength(EXTENSION_UI_SURFACE_LIMITS.maxWidgetLines);
    expect(widget?.lines[0]?.length).toBe(EXTENSION_UI_SURFACE_LIMITS.maxWidgetLineLength);
  });

  it('reset pushes an empty snapshot so clients drop stale extension state', () => {
    const push = vi.fn();
    const store = new ExtensionUiSurfaceStore({ push });
    store.apply('s1', { kind: 'working-message', message: 'thinking hard' });
    vi.runAllTimers();
    push.mockClear();
    store.reset('s1');
    store.reset('never-used');
    vi.runAllTimers();
    expect(push.mock.calls).toEqual([
      [{ type: 'extension/ui_surface', snapshot: { sessionId: 's1', statuses: [], widgets: [] } }],
    ]);
  });
});
