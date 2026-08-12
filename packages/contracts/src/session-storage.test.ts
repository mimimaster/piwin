import { describe, expect, it } from 'vitest';
import {
  SESSION_BODY_OFFLOADED,
  SESSION_PACK_MISSING,
  SessionBodyUnavailableError,
  assertSessionBodyAvailable,
  isSessionBodyAvailable,
  parseSessionStorageInfo,
  projectRemoteSessionStorage,
  resolveSessionStorageState,
} from './session-storage.js';

describe('session storage residency', () => {
  it('treats a missing storage field as local', () => {
    expect(resolveSessionStorageState({})).toBe('local');
    expect(resolveSessionStorageState(undefined)).toBe('local');
    expect(isSessionBodyAvailable({})).toBe(true);
  });

  it('parses a valid offloaded storage record and ignores unknown fields', () => {
    const parsed = parseSessionStorageInfo({
      state: 'offloaded',
      packId: 'ses_demo-20260812T103000Z-abcd',
      packPath: '/Volumes/Drive/piwin-packs/ses_demo.piwin-pack',
      packArchiveSha256: 'a'.repeat(64),
      transcriptSha256: 'b'.repeat(64),
      mediaTreeSha256: 'c'.repeat(64),
      offloadedAt: '2026-08-12T10:30:00.000Z',
      offloadedBytes: 4096,
      coldPreview: 'archived chat preview',
      extra: 'drop-me',
    });
    expect(parsed).toEqual({
      state: 'offloaded',
      packId: 'ses_demo-20260812T103000Z-abcd',
      packPath: '/Volumes/Drive/piwin-packs/ses_demo.piwin-pack',
      packArchiveSha256: 'a'.repeat(64),
      transcriptSha256: 'b'.repeat(64),
      mediaTreeSha256: 'c'.repeat(64),
      offloadedAt: '2026-08-12T10:30:00.000Z',
      offloadedBytes: 4096,
      coldPreview: 'archived chat preview',
    });
  });

  it('rejects invalid storage payloads instead of inventing local authority', () => {
    expect(parseSessionStorageInfo({ state: 'packing' })).toBeUndefined();
    expect(parseSessionStorageInfo({ state: 'offloaded', offloadedBytes: -1 })).toEqual({
      state: 'offloaded',
    });
    expect(parseSessionStorageInfo('offloaded')).toBeUndefined();
  });

  it('blocks body access for offloaded and missing-pack sessions with stable codes', () => {
    expect(() =>
      assertSessionBodyAvailable(
        {
          id: 'ses_off',
          storage: { state: 'offloaded' },
        },
        'resume',
      ),
    ).toThrow(SessionBodyUnavailableError);

    try {
      assertSessionBodyAvailable({ id: 'ses_off', storage: { state: 'offloaded' } }, 'resume');
      throw new Error('expected guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionBodyUnavailableError);
      const unavailable = error as SessionBodyUnavailableError;
      expect(unavailable.code).toBe(SESSION_BODY_OFFLOADED);
      expect(unavailable.message).toContain(SESSION_BODY_OFFLOADED);
      expect(unavailable.message).toContain('ses_off');
      expect(unavailable.operation).toBe('resume');
    }

    try {
      assertSessionBodyAvailable({ id: 'ses_miss', storage: { state: 'missing-pack' } }, 'export');
      throw new Error('expected guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionBodyUnavailableError);
      const unavailable = error as SessionBodyUnavailableError;
      expect(unavailable.code).toBe(SESSION_PACK_MISSING);
      expect(unavailable.message).toContain(SESSION_PACK_MISSING);
    }
  });

  it('allows body access for local and legacy records', () => {
    expect(() => assertSessionBodyAvailable({ id: 'ses_local' }, 'prompt')).not.toThrow();
    expect(() =>
      assertSessionBodyAvailable({ id: 'ses_local', storage: { state: 'local' } }, 'prompt'),
    ).not.toThrow();
    expect(isSessionBodyAvailable({ storage: { state: 'offloaded' } })).toBe(false);
    expect(isSessionBodyAvailable({ storage: { state: 'missing-pack' } })).toBe(false);
  });

  it('projects remote storage without Host pack paths', () => {
    expect(
      projectRemoteSessionStorage({
        state: 'offloaded',
        packId: 'pack-1',
        packPath: '/Users/me/.not-for-remote/session.piwin-pack',
        packArchiveSha256: 'deadbeef',
        coldPreview: 'preview',
        offloadedBytes: 12,
      }),
    ).toEqual({
      state: 'offloaded',
      packId: 'pack-1',
      coldPreview: 'preview',
      offloadedBytes: 12,
    });
    expect(projectRemoteSessionStorage({ state: 'local' })).toBeUndefined();
  });
});
