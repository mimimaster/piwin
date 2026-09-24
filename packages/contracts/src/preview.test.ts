import { describe, expect, it } from 'vitest';
import { denyRemoteLocalFileTarget, type DocumentPathResolveData } from './preview.js';

const localFileResolved: DocumentPathResolveData = {
  status: 'resolved',
  target: { kind: 'local-file', absolutePath: '/tmp/shot.png', displayRef: '/tmp/shot.png' },
  attempts: [
    { route: 'media', reason: 'not-a-vault-path' },
    { route: 'local-file', reason: 'exists' },
  ],
};

describe('denyRemoteLocalFileTarget', () => {
  it('refuses a host path without saying whether the file exists', () => {
    const refused = denyRemoteLocalFileTarget(localFileResolved);
    expect(refused).toEqual({
      status: 'unresolved',
      reason: 'remote-local-path-denied',
      attempts: [
        { route: 'media', reason: 'not-a-vault-path' },
        { route: 'local-file', reason: 'channel-denied-by-remote-shell' },
      ],
    });
    expect(JSON.stringify(refused)).not.toContain('exists');
    expect(JSON.stringify(refused)).not.toContain('/tmp/shot.png');
  });

  it('hides a miss the same way it hides a hit', () => {
    const missing: DocumentPathResolveData = {
      status: 'unresolved',
      reason: 'not-found',
      attempts: [
        { route: 'project', reason: 'not-inside-project-root' },
        { route: 'local-file', reason: 'no-such-file' },
      ],
    };
    const refused = denyRemoteLocalFileTarget(missing);
    expect(refused).toEqual({
      status: 'unresolved',
      reason: 'remote-local-path-denied',
      attempts: [
        { route: 'project', reason: 'not-inside-project-root' },
        { route: 'local-file', reason: 'channel-denied-by-remote-shell' },
      ],
    });
  });

  it('leaves logical targets alone — they carry no host path', () => {
    const projectFile: DocumentPathResolveData = {
      status: 'resolved',
      target: { kind: 'project-file', relativePath: 'docs/a.md', displayRef: 'docs/a.md' },
      attempts: [],
    };
    expect(denyRemoteLocalFileTarget(projectFile)).toBe(projectFile);
    expect(
      denyRemoteLocalFileTarget({ status: 'unresolved', reason: 'not-found', attempts: [] }),
    ).toEqual({ status: 'unresolved', reason: 'not-found', attempts: [] });
  });
});
