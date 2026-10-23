import { afterEach, describe, expect, it } from 'vitest';
import {
  beginPanelResize,
  isPanelResizeActive,
  subscribePanelResizeActivity,
} from './panel-resize-activity.js';

describe('panel resize activity', () => {
  const releases: Array<() => void> = [];

  afterEach(() => {
    for (const release of releases.splice(0)) {
      release();
    }
  });

  it('notifies once per active span and ignores repeated release', () => {
    const events: boolean[] = [];
    const unsubscribe = subscribePanelResizeActivity((active) => events.push(active));
    const release = beginPanelResize();
    releases.push(release);

    expect(isPanelResizeActive()).toBe(true);
    release();
    release();

    expect(isPanelResizeActive()).toBe(false);
    expect(events).toEqual([true, false]);
    unsubscribe();
  });

  it('stays active until every overlapping drag releases', () => {
    const events: boolean[] = [];
    const unsubscribe = subscribePanelResizeActivity((active) => events.push(active));
    const releaseSidebar = beginPanelResize();
    const releaseRightPanel = beginPanelResize();
    releases.push(releaseSidebar, releaseRightPanel);

    releaseSidebar();
    expect(isPanelResizeActive()).toBe(true);
    releaseRightPanel();

    expect(isPanelResizeActive()).toBe(false);
    expect(events).toEqual([true, false]);
    unsubscribe();
  });
});
