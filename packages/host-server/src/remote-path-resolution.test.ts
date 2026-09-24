/**
 * `preview/resolve-path` on a remote connection (ADR 0052 §6).
 *
 * The command itself is remote-safe — the Host is the only thing that knows
 * its own home, config root, and realpath aliases — but its *answer* may name a
 * file on the Host's disk. That answer must never reach a remote client, and an
 * unusable payload must never reach the Host.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentPathResolveData } from '@piwin/contracts';
import { isSafeRemoteCommand } from './host-server-support.js';
import { projectRemoteResponse } from './remote-projection.js';

const CONTEXT = {
  hostInstanceId: 'host-1',
  mode: 'sdk' as const,
  capabilities: {
    pushSequencing: true,
    replay: true,
    snapshot: true,
    sessionRead: true,
    sessionControl: true,
    permissionResolve: true,
    mediaUpload: true,
  },
};

describe('isSafeRemoteCommand preview/resolve-path', () => {
  it('accepts a raw path with an optional workspace and session', () => {
    expect(
      isSafeRemoteCommand({
        type: 'preview/resolve-path',
        input: {
          rawPath: '~/.piwin/pi-agent/auth.json',
          projectPath: '/srv/proj',
          sessionId: 's1',
        },
      }),
    ).toBe(true);
    expect(
      isSafeRemoteCommand({ type: 'preview/resolve-path', input: { rawPath: 'notes.md' } }),
    ).toBe(true);
  });

  it('rejects an empty path, a NUL byte, and an over-long path', () => {
    expect(isSafeRemoteCommand({ type: 'preview/resolve-path', input: { rawPath: '' } })).toBe(
      false,
    );
    expect(isSafeRemoteCommand({ type: 'preview/resolve-path', input: { rawPath: 'a\0b' } })).toBe(
      false,
    );
    expect(
      isSafeRemoteCommand({
        type: 'preview/resolve-path',
        input: { rawPath: 'x'.repeat(4097) },
      }),
    ).toBe(false);
  });
});

describe('projectRemoteResponse preview/resolve-path', () => {
  it('refuses a resolved host path instead of handing over the layout', () => {
    const data: DocumentPathResolveData = {
      status: 'resolved',
      target: {
        kind: 'local-file',
        absolutePath: '/Users/wren/notes.md',
        displayRef: '~/notes.md',
      },
      attempts: [
        { route: 'project', reason: 'not-inside-project-root' },
        { route: 'local-file', reason: 'exists' },
      ],
    };

    const projected = projectRemoteResponse(
      { type: 'preview/resolve-path', input: { rawPath: '~/notes.md' } },
      { type: 'response', command: 'preview/resolve-path', success: true, data },
      CONTEXT,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) return;
    expect(projected.data).toEqual({
      status: 'unresolved',
      reason: 'remote-local-path-denied',
      attempts: [
        { route: 'project', reason: 'not-inside-project-root' },
        { route: 'local-file', reason: 'channel-denied-by-remote-shell' },
      ],
    });
    const serialized = JSON.stringify(projected.success ? projected.data : null);
    expect(serialized).not.toContain('/Users/wren');
    expect(serialized).not.toContain('exists');
  });

  it('hides a disk miss too, so a remote client cannot tell hit from miss', () => {
    const data: DocumentPathResolveData = {
      status: 'unresolved',
      reason: 'not-found',
      attempts: [
        { route: 'project', reason: 'not-inside-project-root' },
        { route: 'local-file', reason: 'no-such-file', detail: '/Users/wren/missing.md' },
      ],
    };

    const projected = projectRemoteResponse(
      { type: 'preview/resolve-path', input: { rawPath: '/Users/wren/missing.md' } },
      { type: 'response', command: 'preview/resolve-path', success: true, data },
      CONTEXT,
    );

    expect(projected.success ? projected.data : null).toEqual({
      status: 'unresolved',
      reason: 'remote-local-path-denied',
      attempts: [
        { route: 'project', reason: 'not-inside-project-root' },
        { route: 'local-file', reason: 'channel-denied-by-remote-shell' },
      ],
    });
    expect(JSON.stringify(projected.success ? projected.data : null)).not.toContain('/Users/wren');
  });

  it('passes a logical target through untouched', () => {
    const data: DocumentPathResolveData = {
      status: 'resolved',
      target: { kind: 'project-file', relativePath: 'docs/plan.md', displayRef: 'docs/plan.md' },
      attempts: [{ route: 'project', reason: 'inside-project-root' }],
    };

    const projected = projectRemoteResponse(
      { type: 'preview/resolve-path', input: { rawPath: 'docs/plan.md' } },
      { type: 'response', command: 'preview/resolve-path', success: true, data },
      CONTEXT,
    );

    expect(projected.success ? projected.data : null).toEqual(data);
  });
});
