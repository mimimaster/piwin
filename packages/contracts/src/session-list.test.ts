import { describe, expect, it } from 'vitest';
import type { HostCommand, SessionListData } from './ipc.js';
import type { SessionListOrder } from './session-list-page.js';

type SessionListCommand = Extract<HostCommand, { type: 'session/list' }>;

describe('session/list contracts', () => {
  it('round-trips a legacy query and response without order, maxItems, totalCount, or truncated', () => {
    const query: SessionListCommand = {
      type: 'session/list',
      scope: { kind: 'general' },
      includeArchived: false,
    };
    const data: SessionListData = {
      sessions: [],
    };

    expect(JSON.parse(JSON.stringify({ query, data }))).toEqual({ query, data });
    expect(query).not.toHaveProperty('order');
    expect(query).not.toHaveProperty('maxItems');
    expect(data).not.toHaveProperty('totalCount');
    expect(data).not.toHaveProperty('truncated');
  });

  it('round-trips a bounded alphabetical query', () => {
    const order: SessionListOrder = 'alphabetical';
    const query: SessionListCommand = {
      type: 'session/list',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      includeArchived: false,
      order,
      maxItems: 2000,
    };

    expect(JSON.parse(JSON.stringify(query))).toEqual(query);
    expect(query.order).toBe('alphabetical');
    expect(query.maxItems).toBe(2000);
  });

  it('round-trips a truncated response with pre-truncation totalCount', () => {
    const data: SessionListData = {
      sessions: [
        {
          id: 's1',
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          projectPath: '',
          updatedAt: '2026-08-13T00:00:00.000Z',
          messageCount: 1,
        },
      ],
      totalCount: 3500,
      truncated: true,
    };

    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(data.totalCount).toBe(3500);
    expect(data.truncated).toBe(true);
    expect(data.sessions).toHaveLength(1);
  });

  it('round-trips an allScopes query', () => {
    const query: SessionListCommand = {
      type: 'session/list',
      allScopes: true,
      includeArchived: true,
    };

    expect(JSON.parse(JSON.stringify(query))).toEqual(query);
    expect(query.allScopes).toBe(true);
    expect(query.includeArchived).toBe(true);
  });
});
