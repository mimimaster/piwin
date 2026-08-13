import { describe, expect, it } from 'vitest';
import { transcriptOwnerBlocksDangerousAction } from './transcript-owner-guard';

describe('transcriptOwnerBlocksDangerousAction', () => {
  it('blocks duplicate/fork/retry while the visible rows still belong to another session', () => {
    expect(
      transcriptOwnerBlocksDangerousAction({
        transcriptOwnerSessionId: 'old-session',
        activeSessionId: 'new-session',
      }),
    ).toBe(true);
  });

  it('allows the action once owner matches the active session', () => {
    expect(
      transcriptOwnerBlocksDangerousAction({
        transcriptOwnerSessionId: 'session-1',
        activeSessionId: 'session-1',
      }),
    ).toBe(false);
  });

  it('allows the action when ownership was cleared with the transcript', () => {
    expect(
      transcriptOwnerBlocksDangerousAction({
        transcriptOwnerSessionId: null,
        activeSessionId: 'session-1',
      }),
    ).toBe(false);
  });
});
