import { describe, expect, it } from 'vitest';
import {
  findLastUserMessage,
  insetComposerText,
  listArchivedHydrationRequests,
  transcriptActivitySignal,
  resolveWorkbenchScopeLabel,
  resolveWorkbenchSessionTitle,
} from './workbench-chrome-assembly.js';

describe('listArchivedHydrationRequests', () => {
  it('always hydrates general, then each project, filling the active project list', () => {
    expect(
      listArchivedHydrationRequests({
        includeArchived: true,
        order: 'updated',
        recentProjects: [{ path: '/a' }, { path: '/b' }],
        activeProjectPath: '/b',
      }),
    ).toEqual([
      {
        scope: { kind: 'general' },
        options: { includeArchived: true, order: 'updated' },
      },
      {
        scope: { kind: 'project', projectPath: '/a' },
        options: { includeArchived: true, order: 'updated' },
      },
      {
        scope: { kind: 'project', projectPath: '/b' },
        options: { includeArchived: true, order: 'updated' },
      },
    ]);
  });
});

describe('resolveWorkbenchSessionTitle', () => {
  it('keeps the document title independent of the project chip', () => {
    expect(
      resolveWorkbenchSessionTitle({
        projectPath: '/repo',
        projectLabel: 'repo',
        sessionName: 'Fix auth',
      }),
    ).toBe('Fix auth');
    expect(
      resolveWorkbenchSessionTitle({
        projectPath: null,
        projectLabel: null,
        sessionName: 'New chat',
      }),
    ).toBe('New chat');
  });
});

describe('findLastUserMessage', () => {
  it('returns the newest user row', () => {
    expect(
      findLastUserMessage([
        { role: 'user', text: 'a' },
        { role: 'assistant', text: 'ok' },
        { role: 'user', text: 'b' },
      ]),
    ).toEqual({ role: 'user', text: 'b' });
  });
});

describe('transcriptActivitySignal', () => {
  it('encodes run phase, counts, and tool states', () => {
    expect(
      transcriptActivitySignal({
        runPhase: 'streaming',
        messages: [{ text: 'hi', thinking: 'mm' }],
        tools: [{ toolCallId: 't1', status: 'done', output: 'ok' }],
      }),
    ).toBe('streaming:1:4:t1:done:2');
  });
});

describe('insetComposerText', () => {
  it('appends below existing composer text', () => {
    expect(insetComposerText('draft', 'cite me')).toBe('draft\n\ncite me');
    expect(insetComposerText('  ', 'cite me')).toBe('cite me');
  });
});

describe('resolveWorkbenchScopeLabel', () => {
  it('uses the locale copy for general and a short project label otherwise', () => {
    expect(
      resolveWorkbenchScopeLabel({
        isGeneral: true,
        locale: 'zh-CN',
        generalCopy: '对话',
      }),
    ).toBe('对话');
    expect(
      resolveWorkbenchScopeLabel({
        isGeneral: false,
        locale: 'zh-CN',
        generalCopy: '对话',
      }),
    ).toBe('项目');
    expect(
      resolveWorkbenchScopeLabel({
        isGeneral: false,
        locale: 'en',
        generalCopy: 'General',
      }),
    ).toBe('Project');
  });
});
