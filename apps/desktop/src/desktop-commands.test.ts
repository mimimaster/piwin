import { describe, expect, it } from 'vitest';
import { commandAvailability, filterDesktopCommands } from './desktop-commands';

describe('desktop-commands', () => {
  it('filters by tokens', () => {
    const hits = filterDesktopCommands('new session');
    expect(hits.some((item) => item.id === 'new-session')).toBe(true);
  });

  it('blocks new session without trust', () => {
    const availability = commandAvailability('new-session', {
      hasProject: true,
      projectTrusted: false,
      hasActiveSession: false,
    });
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/Trust/i);
  });

  it('matches session-switching queries after the tab strip removal (R2)', () => {
    for (const query of ['switch session', 'jump to session', 'switch']) {
      const hits = filterDesktopCommands(query);
      expect(
        hits.some((item) => item.id === 'search-sessions'),
        `expected "${query}" to match search-sessions`,
      ).toBe(true);
    }
  });

  it('keeps session search available for General conversations without a project', () => {
    const availability = commandAvailability('search-sessions', {
      hasProject: false,
      projectTrusted: false,
      hasActiveSession: false,
    });
    expect(availability).toEqual({ available: true });
  });

  it('exposes Open Activity not dock wording', () => {
    const hits = filterDesktopCommands('activity');
    expect(hits.some((item) => item.id === 'open-activity')).toBe(true);
    expect(hits.some((item) => item.title.toLowerCase().includes('dock'))).toBe(false);
  });
});
