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
  it('lists server ids without claiming a status before mcp/status answers', () => {
    expect(mapComposerMenuMcp({ github: {}, slack: { disabled: true } })).toEqual([
      { id: 'github', name: 'github', status: 'unknown', globallyDisabled: false },
      { id: 'slack', name: 'slack', status: 'disabled', globallyDisabled: true },
    ]);
  });

  it('joins runtime health for status and tool counts', () => {
    expect(
      mapComposerMenuMcp({ github: {}, linear: {} }, [
        { serverId: 'github', status: 'running', command: 'gh', disabled: false, toolCount: 24 },
        { serverId: 'linear', status: 'error', command: 'ln', disabled: false, toolCount: 0 },
      ]),
    ).toEqual([
      { id: 'github', name: 'github', status: 'running', toolCount: 24, globallyDisabled: false },
      { id: 'linear', name: 'linear', status: 'error', globallyDisabled: false },
    ]);
  });
});
