import { describe, expect, it } from 'vitest';
import { mapComposerMenuMcp, mapComposerMenuSkills } from './use-composer-plus-menu.js';

describe('mapComposerMenuSkills', () => {
  it('fills a missing name from the id and treats omitted enabled as on', () => {
    expect(
      mapComposerMenuSkills([
        { id: 'search' },
        { id: 'browser', name: 'Browser', enabled: false },
      ]),
    ).toEqual([
      { id: 'search', name: 'search', enabled: true },
      { id: 'browser', name: 'Browser', enabled: false },
    ]);
  });
});

describe('mapComposerMenuMcp', () => {
  it('lists server ids without claiming they are running', () => {
    expect(mapComposerMenuMcp({ github: {}, slack: {} })).toEqual([
      { id: 'github', name: 'github', running: false },
      { id: 'slack', name: 'slack', running: false },
    ]);
  });
});
