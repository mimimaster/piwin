import { describe, expect, it } from 'vitest';

import { createWorkspaceActivityLog } from './workspace-activity-log.js';

describe('createWorkspaceActivityLog', () => {
  it('reports other owners active on an overlapping root after the window opens', () => {
    const log = createWorkspaceActivityLog();
    const shell = log.begin({ root: '/repo', kind: 'shell', ownerId: 'a' });
    log.begin({ root: '/repo/pkg', kind: 'file-write', ownerId: 'b', fileKeys: ['/repo/pkg/x.ts'] }).end();
    log.begin({ root: '/repo', kind: 'shell', ownerId: 'c' }).end();
    log.begin({ root: '/other', kind: 'file-write', ownerId: 'b', fileKeys: ['/other/y.ts'] }).end();
    log.begin({ root: '/repo', kind: 'file-write', ownerId: 'a', fileKeys: ['/repo/own.ts'] }).end();

    expect(log.othersSince({ root: '/repo', fromTick: shell.startTick, ownerId: 'a' })).toEqual({
      complete: true,
      fileWrites: ['/repo/pkg/x.ts'],
      exclusiveCount: 0,
      shellCount: 1,
    });
  });

  it('ignores activity that ended before the window and counts one still running', () => {
    const log = createWorkspaceActivityLog();
    log.begin({ root: '/repo', kind: 'file-write', ownerId: 'b', fileKeys: ['/repo/old.ts'] }).end();
    const running = log.begin({ root: '/repo', kind: 'shell', ownerId: 'b' });
    const from = log.now();
    const summary = log.othersSince({ root: '/repo', fromTick: from, ownerId: 'a' });
    expect(summary.fileWrites).toEqual([]);
    expect(summary.shellCount).toBe(1);
    running.end();
  });

  it('counts unowned activity (Host Git, integrate) as another owner', () => {
    const log = createWorkspaceActivityLog();
    const from = log.now();
    log.begin({ root: '/repo', kind: 'exclusive' }).end();
    expect(log.othersSince({ root: '/repo', fromTick: from, ownerId: 'a' }).exclusiveCount).toBe(1);
  });

  it('filters file writes to one file when asked', () => {
    const log = createWorkspaceActivityLog();
    const from = log.now();
    log.begin({ root: '/repo', kind: 'file-write', ownerId: 'b', fileKeys: ['/repo/x.ts'] }).end();
    expect(
      log.othersSince({ root: '/repo', fromTick: from, ownerId: 'a', fileKey: '/repo/y.ts' }).fileWrites,
    ).toEqual([]);
  });

  it('marks windows older than the retained history incomplete but keeps live records', () => {
    const log = createWorkspaceActivityLog({ capacity: 2 });
    const live = log.begin({ root: '/repo', kind: 'shell', ownerId: 'b' });
    const from = log.now();
    for (let index = 0; index < 5; index += 1) {
      log.begin({ root: '/repo', kind: 'file-write', ownerId: 'c', fileKeys: [`/repo/${index}`] }).end();
    }
    const summary = log.othersSince({ root: '/repo', fromTick: from, ownerId: 'a' });
    expect(summary.complete).toBe(false);
    expect(summary.shellCount).toBe(1);
    live.end();
  });
});
