import { describe, expect, it, vi } from 'vitest';
import { createHostVoiceDelegationPrompt } from './admit-voice-delegation.js';

describe('createHostVoiceDelegationPrompt', () => {
  it('prompts an idle session with voice-delegation source', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/prompt',
      success: true as const,
      data: { runId: 'run-1' },
    }));
    const prompt = createHostVoiceDelegationPrompt({ handleCommand });
    const result = await prompt.admitVoiceDelegation({
      sessionId: 's1',
      instruction: 'open the file',
      callId: 'c1',
      providerDelegationId: 'd1',
      queue: false,
    });
    expect(result).toEqual({ queued: false, runId: 'run-1', messageId: 'voice-c1-d1' });
    expect(handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/prompt',
        sessionId: 's1',
        input: expect.objectContaining({
          source: 'voice-delegation',
          voiceCallId: 'c1',
          text: 'open the file',
        }),
      }),
    );
  });

  it('queues when the session is busy', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/queued-turn-submit',
      success: true as const,
      data: {},
    }));
    const prompt = createHostVoiceDelegationPrompt({ handleCommand });
    const result = await prompt.admitVoiceDelegation({
      sessionId: 's1',
      instruction: 'later',
      callId: 'c1',
      providerDelegationId: 'd2',
      queue: true,
    });
    expect(result).toEqual({
      queued: true,
      queuedTurnId: 'qt-c1-d2',
      messageId: 'voice-c1-d2',
    });
    expect(handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/queued-turn-submit',
        queuedTurnId: 'qt-c1-d2',
      }),
    );
  });

  it('does not invent a runId when session/prompt succeeds without one', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/prompt',
      success: true as const,
      data: {},
    }));
    const prompt = createHostVoiceDelegationPrompt({ handleCommand });
    await expect(
      prompt.admitVoiceDelegation({
        sessionId: 's1',
        instruction: 'no run',
        callId: 'c1',
        providerDelegationId: 'd3',
        queue: false,
      }),
    ).rejects.toThrow('voice-delegation-missing-run');
  });
});
