import { describe, expect, it } from 'vitest';
import {
  DESKTOP_REMOTE_SESSION_LIST_MAX_ITEMS,
  DESKTOP_SESSION_LIST_MAX_ITEMS,
  desktopSessionListMaxItems,
} from './session-list-policy';

describe('desktopSessionListMaxItems', () => {
  it('keeps the local sidecar at the existing 2000-row bound', () => {
    expect(desktopSessionListMaxItems('live')).toBe(DESKTOP_SESSION_LIST_MAX_ITEMS);
    expect(desktopSessionListMaxItems('mock')).toBe(DESKTOP_SESSION_LIST_MAX_ITEMS);
  });

  it('caps remote lists to Host hydration size', () => {
    expect(desktopSessionListMaxItems('remote')).toBe(DESKTOP_REMOTE_SESSION_LIST_MAX_ITEMS);
    expect(DESKTOP_REMOTE_SESSION_LIST_MAX_ITEMS).toBeLessThan(DESKTOP_SESSION_LIST_MAX_ITEMS);
  });
});
