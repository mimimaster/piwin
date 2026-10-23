import { describe, expect, it, beforeEach } from 'vitest';
import {
  canRevealInLocalFileManager,
  clearLocalRootPresenceForTests,
  rememberLocalRootPresence,
  revealDisabledHint,
} from './local-file-reveal-policy.js';

describe('canRevealInLocalFileManager', () => {
  beforeEach(() => {
    clearLocalRootPresenceForTests();
  });

  it('allows ordinary local absolute paths with no remote probe', () => {
    expect(canRevealInLocalFileManager('/Users/me/piwin/apps/desktop/src/a.ts')).toBe(true);
  });

  it('rejects opaque remote project ids', () => {
    expect(canRevealInLocalFileManager('project-aaaaaaaaaaaaaaaaaaaaaaaa/src/a.ts')).toBe(false);
  });

  it('keeps remote roots off until Desktop marks them present', () => {
    rememberLocalRootPresence('/home/host/work/app', 'unknown');
    expect(canRevealInLocalFileManager('/home/host/work/app/src/a.ts')).toBe(false);
    rememberLocalRootPresence('/home/host/work/app', 'absent');
    expect(canRevealInLocalFileManager('/home/host/work/app/src/a.ts')).toBe(false);
    rememberLocalRootPresence('/home/host/work/app', 'present');
    expect(canRevealInLocalFileManager('/home/host/work/app/src/a.ts')).toBe(true);
  });

  it('localizes the remote disabled hint', () => {
    expect(revealDisabledHint('zh-CN')).toContain('远程');
    expect(revealDisabledHint('en')).toContain('remote Host');
  });
});
