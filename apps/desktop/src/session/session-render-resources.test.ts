import { describe, expect, it, vi } from 'vitest';
import {
  createSessionRenderResourceRegistry,
  sessionRenderResourceKey,
} from './session-render-resources.js';

function fixture() {
  const queue: (() => void)[] = [];
  const registry = createSessionRenderResourceRegistry((task) => {
    let cancelled = false;
    queue.push(() => {
      if (!cancelled) task();
    });
    return () => {
      cancelled = true;
    };
  });
  return {
    registry,
    flush: () => {
      for (const task of queue.splice(0)) task();
    },
  };
}

describe('inactive session render resources', () => {
  it('protects every visible split pane and releases only an inactive session at idle', () => {
    const { registry, flush } = fixture();
    const current = vi.fn();
    const split = vi.fn();
    const old = vi.fn();
    registry.register('current', current);
    registry.register('split', split);
    registry.register('old', old);
    registry.setVisible(['current', 'split']);
    expect(old).not.toHaveBeenCalled();
    flush();
    expect(old).toHaveBeenCalledOnce();
    expect(current).not.toHaveBeenCalled();
    expect(split).not.toHaveBeenCalled();
    registry.requestReclaim();
    flush();
    expect(old).toHaveBeenCalledOnce();
  });
  it('rechecks visibility when navigation returns before the idle callback', () => {
    const { registry, flush } = fixture();
    const first = vi.fn();
    const second = vi.fn();
    registry.register('first', first);
    registry.register('second', second);
    registry.setVisible(['first']);
    registry.setVisible(['second']);
    registry.setVisible(['first']);
    flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
  it('permits another reclamation only after a session was shown again', () => {
    const { registry, flush } = fixture();
    const release = vi.fn();
    registry.register('old', release);
    registry.setVisible(['other']);
    flush();
    registry.setVisible(['old']);
    flush();
    expect(release).toHaveBeenCalledOnce();
    registry.setVisible(['other']);
    flush();
    expect(release).toHaveBeenCalledTimes(2);
  });
  it('protects resources until the visible-session inventory is known', () => {
    const { registry, flush } = fixture();
    const release = vi.fn();
    registry.register('current', release);
    registry.requestReclaim();
    flush();
    expect(release).not.toHaveBeenCalled();
  });
  it('does not release resources which unmounted before the idle callback', () => {
    const { registry, flush } = fixture();
    const release = vi.fn();
    const unregister = registry.register('old', release);
    registry.setVisible(['current']);
    unregister();
    flush();
    expect(release).not.toHaveBeenCalled();
  });
  it('keeps equal session ids on different Hosts separate', () => {
    const { registry, flush } = fixture();
    const first = vi.fn();
    const second = vi.fn();
    registry.register(sessionRenderResourceKey('host-a', 'same'), first);
    registry.register(sessionRenderResourceKey('host-b', 'same'), second);
    registry.setVisible([sessionRenderResourceKey('host-b', 'same')]);
    flush();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
  it('rechecks each release if a previous callback makes another session visible', () => {
    const { registry, flush } = fixture();
    const release = vi.fn();
    registry.register('first', () => registry.setVisible(['second']));
    registry.register('second', release);
    registry.setVisible(['current']);
    flush();
    expect(release).not.toHaveBeenCalled();
  });

  describe('restoring marker', () => {
    it('tracks set/clear and the restoring count', () => {
      const { registry } = fixture();
      expect(registry.isRestoring('a')).toBe(false);
      expect(registry.restoringCount()).toBe(0);
      registry.setRestoring('a', true);
      expect(registry.isRestoring('a')).toBe(true);
      expect(registry.restoringCount()).toBe(1);
      registry.setRestoring('a', true);
      expect(registry.restoringCount()).toBe(1);
      registry.setRestoring('a', false);
      expect(registry.isRestoring('a')).toBe(false);
      expect(registry.restoringCount()).toBe(0);
    });

    it('never reclaims a presentation that is mid-restore', () => {
      const { registry, flush } = fixture();
      const restore = vi.fn();
      const old = vi.fn();
      registry.register('restoring', restore);
      registry.register('old', old);
      registry.setRestoring('restoring', true);
      registry.setVisible(['current']);
      flush();
      expect(restore).not.toHaveBeenCalled();
      expect(old).toHaveBeenCalledOnce();
      // An explicit manual/automatic reclaim pass must skip it too.
      registry.requestReclaim();
      flush();
      expect(restore).not.toHaveBeenCalled();
    });

    it('clearing the mark releases a still-hidden session at the next idle pass', () => {
      const { registry, flush } = fixture();
      const restore = vi.fn();
      registry.register('restoring', restore);
      registry.setRestoring('restoring', true);
      registry.setVisible(['current']);
      flush();
      expect(restore).not.toHaveBeenCalled();
      registry.setRestoring('restoring', false);
      flush();
      expect(restore).toHaveBeenCalledOnce();
    });

    it('treats a registering restoring session like a visible one', () => {
      const { registry, flush } = fixture();
      const restore = vi.fn();
      registry.setVisible(['current']);
      registry.setRestoring('restoring', true);
      registry.register('restoring', restore);
      flush();
      expect(restore).not.toHaveBeenCalled();
    });

    it('counts visible presentations separately from restoring ones', () => {
      const { registry } = fixture();
      registry.register('a', vi.fn());
      registry.register('b', vi.fn());
      registry.setVisible(['a']);
      registry.setRestoring('b', true);
      expect(registry.count()).toBe(2);
      expect(registry.visibleCount()).toBe(1);
      expect(registry.restoringCount()).toBe(1);
    });

    it('reset() drops the restoring marks', () => {
      const { registry } = fixture();
      registry.setRestoring('a', true);
      registry.reset();
      expect(registry.isRestoring('a')).toBe(false);
      expect(registry.restoringCount()).toBe(0);
    });
  });
});
