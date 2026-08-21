import { describe, expect, it } from 'vitest';
import { isSafeRemotePermissionRulesCommand } from './remote-permission-rules.js';

describe('isSafeRemotePermissionRulesCommand', () => {
  it('admits a user-global rules write', () => {
    expect(
      isSafeRemotePermissionRulesCommand({
        type: 'permissions/set-rules',
        layer: 'user',
        rules: {
          version: 1,
          deny: [
            {
              target: { kind: 'file-write', pathGlob: '**/.env' },
              decision: 'deny',
              reason: 'secrets',
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('rejects a rules document with an empty reason', () => {
    expect(
      isSafeRemotePermissionRulesCommand({
        type: 'permissions/set-rules',
        layer: 'user',
        rules: {
          version: 1,
          deny: [
            {
              target: { kind: 'file-write', pathGlob: '**/.env' },
              decision: 'deny',
              reason: '',
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
