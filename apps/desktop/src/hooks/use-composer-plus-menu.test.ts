import { describe, expect, it } from 'vitest';
import { mapComposerMenuMcp, mapComposerMenuSkills } from './use-composer-plus-menu.js';

describe('mapComposerMenuSkills', () => {
  it('fills a missing name from the id and treats omitted enabled as on', () => {
    expect(
      mapComposerMenuSkills([
        { id: 'search' },
        { id: 'browser', name: 'Browser', enabled: false },
        { id: 'proj', name: 'proj', enabled: true, source: 'project' },
      ]),
    ).toEqual([
      { id: 'search', name: 'search', enabled: true },
      { id: 'browser', name: 'Browser', enabled: false },
      { id: 'proj', name: 'proj', enabled: true, source: 'project' },
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
