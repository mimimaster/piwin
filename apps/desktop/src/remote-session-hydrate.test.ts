import { describe, expect, it } from 'vitest';
import {
  isRemoteDesktopTransport,
  mapListedProjects,
  mapListedSessionItems,
  sessionListCommandForTransport,
} from './remote-session-hydrate';

describe('sessionListCommandForTransport', () => {
  it('keeps path-owning scope on the local sidecar', () => {
    expect(
      sessionListCommandForTransport({
        transport: 'live',
        scope: { kind: 'project', projectPath: '/Users/me/proj' },
        maxItems: 50,
      }),
    ).toEqual({
      type: 'session/list',
      scope: { kind: 'project', projectPath: '/Users/me/proj' },
      maxItems: 50,
    });
  });

  it('uses scopeRef general on remote and never sends path-owning scope', () => {
    const command = sessionListCommandForTransport({
      transport: 'remote',
      scope: { kind: 'general' },
      includeArchived: false,
      order: 'updated',
      maxItems: 50,
    });
    expect(command).toEqual({
      type: 'session/list',
      scopeRef: { kind: 'general' },
      includeArchived: false,
      order: 'updated',
      maxItems: 50,
    });
    expect('scope' in command && command.scope !== undefined).toBe(false);
    if (command.type === 'session/list') {
      expect(JSON.stringify(command.scopeRef)).not.toContain('/');
    }
  });

  it('lists a remote project by opaque projectId, not a filesystem path', () => {
    const command = sessionListCommandForTransport({
      transport: 'remote',
      scope: { kind: 'project', projectPath: 'project-abc' },
      maxItems: 50,
    });
    expect(command).toEqual({
      type: 'session/list',
      scopeRef: { kind: 'project', projectId: 'project-abc' },
      maxItems: 50,
    });
    expect('scope' in command && command.scope !== undefined).toBe(false);
    expect(command.type).toBe('session/list');
    if (command.type === 'session/list') {
      expect(JSON.stringify(command.scopeRef)).not.toContain('/');
    }
  });

  it('lists all authorized remote sessions without a path-owning scope', () => {
    const command = sessionListCommandForTransport({
      transport: 'remote',
      scope: { kind: 'general' },
      allScopes: true,
      includeArchived: true,
    });
    expect(command).toEqual({
      type: 'session/list',
      scopeRef: { kind: 'all-authorized' },
      includeArchived: true,
    });
    expect('scope' in command && command.scope !== undefined).toBe(false);
  });
});

describe('mapListedSessionItems', () => {
  it('maps a projected remote list that uses sessionId instead of id', () => {
    const listed = mapListedSessionItems({
      sessions: [
        {
          sessionId: 's-general',
          name: 'General chat',
          scope: 'general',
          updatedAt: '2026-08-13T00:00:00.000Z',
        },
        {
          sessionId: 's-project',
          name: 'Project chat',
          scope: 'project',
          projectId: 'project-abc',
          lastPreview: 'hello',
        },
      ],
      totalCount: 2,
      truncated: false,
    });
    expect(listed.sessions).toEqual([
      {
        id: 's-general',
        name: 'General chat',
        updatedAt: '2026-08-13T00:00:00.000Z',
        scope: { kind: 'general' },
      },
      {
        id: 's-project',
        name: 'Project chat',
        lastPreview: 'hello',
        scope: { kind: 'project', projectPath: 'project-abc' },
      },
    ]);
    expect(listed.totalCount).toBe(2);
  });

  it('keeps local SessionSummary id/scope unchanged', () => {
    const listed = mapListedSessionItems({
      sessions: [
        {
          id: 'local-1',
          name: 'Local',
          scope: { kind: 'project', projectPath: '/tmp/proj' },
        },
      ],
    });
    expect(listed.sessions[0]).toMatchObject({
      id: 'local-1',
      scope: { kind: 'project', projectPath: '/tmp/proj' },
    });
  });
});

describe('mapListedProjects', () => {
  it('maps remote projectId + displayName onto a synthetic path key', () => {
    expect(
      mapListedProjects({
        projects: [{ projectId: 'project-abc', displayName: 'Demo', trust: 'trusted' }],
      }),
    ).toEqual([
      {
        path: 'project-abc',
        displayName: 'Demo',
        trust: 'trusted',
        lastOpenedAt: '',
        createdAt: '',
      },
    ]);
  });

  it('keeps local ProjectRecord paths', () => {
    expect(
      mapListedProjects({
        projects: [
          {
            path: '/Users/me/proj',
            trust: 'trusted',
            lastOpenedAt: 't',
            createdAt: 'c',
            displayName: 'proj',
          },
        ],
      }),
    ).toEqual([
      {
        path: '/Users/me/proj',
        trust: 'trusted',
        lastOpenedAt: 't',
        createdAt: 'c',
        displayName: 'proj',
      },
    ]);
  });
});

describe('isRemoteDesktopTransport', () => {
  it('is true only for the remote WebSocket transport', () => {
    expect(isRemoteDesktopTransport('remote')).toBe(true);
    expect(isRemoteDesktopTransport('live')).toBe(false);
    expect(isRemoteDesktopTransport('mock')).toBe(false);
  });
});
