import { describe, expect, it } from 'vitest';
import { navTabForRoute } from './use-wide-layout.js';

describe('navTabForRoute', () => {
  it('maps detail routes onto the docked bottom-nav tab', () => {
    expect(navTabForRoute('chat')).toBe('sessions');
    expect(navTabForRoute('inbox')).toBe('activity');
    expect(navTabForRoute('wiki-detail')).toBe('knowledge');
    expect(navTabForRoute('automations')).toBe('desk');
  });
});
