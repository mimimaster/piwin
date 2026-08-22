import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import {
  activateProjectOnHost,
  hydrationSessionApplyActions,
  isOpaqueRemoteProjectId,
  isRemoteDesktopTransport,
  mapListedProjects,
  mapListedSessionItems,
  mergeRecentProjects,
  sessionCreateInputForTransport,
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

  it('keeps last-used composer model and thinking level from local summaries', () => {
    const listed = mapListedSessionItems({
      sessions: [
        {
          id: 'local-gemini',
          name: 'Gemini chat',
          scope: { kind: 'general' },
          model: {
            protocol: 'openai-compatible',
            providerId: 'cpa',
            modelId: 'gemini-3.7-flash',
          },
          thinkingLevel: 'high',
        },
      ],
    });
    expect(listed.sessions[0]).toMatchObject({
      id: 'local-gemini',
      model: {
        protocol: 'openai-compatible',
        providerId: 'cpa',
        modelId: 'gemini-3.7-flash',
      },
      thinkingLevel: 'high',
    });
  });
});

describe('mapListedProjects', () => {
  it('maps remote projectId + displayName onto a synthetic path key', () => {
    expect(
      mapListedProjects({
        projects: [
          {
            projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
            displayName: 'Demo',
            trust: 'trusted',
          },
        ],
      }),
    ).toEqual([
      {
        path: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        displayName: 'Demo',
        trust: 'trusted',
        lastOpenedAt: '',
        createdAt: '',
      },
    ]);
  });

  it('prefers opaque projectId when a Host path is also present', () => {
    const listed = mapListedProjects({
      projects: [
        {
          projectId: 'project-bbbbbbbbbbbbbbbbbbbbbbbb',
          path: '/Users/me/piwin',
          displayName: 'piwin',
          trust: 'trusted',
        },
      ],
    });
    expect(listed[0]?.path).toBe('project-bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(listed[0]?.path).not.toContain('/');
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

describe('hydrationSessionApplyActions', () => {
  it('replaces each scope once instead of one update per session', () => {
    const actions = hydrationSessionApplyActions([
      { id: 'g1', name: 'General', scope: { kind: 'general' } },
      { id: 'g2', name: 'Also general' },
      { id: 'p1', name: 'In project', scope: { kind: 'project', projectPath: 'project-a' } },
      { id: 'p2', name: 'Same project', scope: { kind: 'project', projectPath: 'project-a' } },
      { id: 'p3', name: 'Other project', scope: { kind: 'project', projectPath: 'project-b' } },
    ]);
    expect(actions).toEqual([
      {
        type: 'session/hydrate-scope',
        scope: { kind: 'general' },
        sessions: [
          { id: 'g1', name: 'General', scope: { kind: 'general' } },
          { id: 'g2', name: 'Also general' },
        ],
        totalCount: 2,
        truncated: false,
      },
      {
        type: 'session/hydrate-scope',
        scope: { kind: 'project', projectPath: 'project-a' },
        sessions: [
          { id: 'p1', name: 'In project', scope: { kind: 'project', projectPath: 'project-a' } },
          { id: 'p2', name: 'Same project', scope: { kind: 'project', projectPath: 'project-a' } },
        ],
        totalCount: 2,
        truncated: false,
      },
      {
        type: 'session/hydrate-scope',
        scope: { kind: 'project', projectPath: 'project-b' },
        sessions: [
          { id: 'p3', name: 'Other project', scope: { kind: 'project', projectPath: 'project-b' } },
        ],
        totalCount: 1,
        truncated: false,
      },
    ]);
  });
});

describe('mergeRecentProjects', () => {
  it('returns the previous array when paths are unchanged', () => {
    const previous = [
      {
        path: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        displayName: 'piwin',
        trust: 'trusted' as const,
        lastOpenedAt: '',
        createdAt: '',
      },
    ];
    const next = mergeRecentProjects(previous, [
      {
        path: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        displayName: 'piwin',
        trust: 'trusted',
        lastOpenedAt: '',
        createdAt: '',
      },
    ]);
    expect(next).toBe(previous);
  });

  it('caps the merged list and keeps the active project', () => {
    const fetched = Array.from({ length: 20 }, (_, index) => ({
      path: `/p/${index}`,
      displayName: `P${index}`,
      trust: 'trusted' as const,
      lastOpenedAt: '',
      createdAt: '',
    }));
    const next = mergeRecentProjects([], fetched, ['/p/19']);
    expect(next).toHaveLength(16);
    expect(next.some((project) => project.path === '/p/19')).toBe(true);
    expect(next.some((project) => project.path === '/p/16')).toBe(false);
  });
});

describe('activateProjectOnHost', () => {
  it('skips project/open for opaque remote project ids', async () => {
    const calls: HostCommand['type'][] = [];
    const result = await activateProjectOnHost(
      async (command) => {
        calls.push(command.type);
        if (command.type === 'project/list') {
          return {
            type: 'response',
            command: 'project/list',
            success: true,
            data: {
              projects: [
                {
                  projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
                  displayName: 'piwin',
                  trust: 'trusted',
                },
              ],
            },
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      },
      'remote',
      'project-aaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(calls).toEqual(['project/list']);
    expect(result).toEqual({
      ok: true,
      path: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
      trusted: true,
    });
  });
});

describe('sessionCreateInputForTransport', () => {
  it('uses projectId on remote opaque keys', () => {
    expect(
      sessionCreateInputForTransport('remote', {
        useGeneral: false,
        projectKey: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        sessionName: 'draft',
      }),
    ).toEqual({
      projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
      sessionName: 'draft',
    });
  });
});

describe('isOpaqueRemoteProjectId', () => {
  it('accepts Host-issued ids and rejects filesystem paths', () => {
    expect(isOpaqueRemoteProjectId('project-aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isOpaqueRemoteProjectId('/Users/me/Developer/piwin')).toBe(false);
    expect(isOpaqueRemoteProjectId('project-abc')).toBe(false);
  });
});
