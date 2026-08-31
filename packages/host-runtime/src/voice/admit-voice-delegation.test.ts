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

  it('steers the current run when the session is busy', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/steer',
      success: true as const,
      data: { sessionId: 's1', runId: 'run-live' },
    }));
    const prompt = createHostVoiceDelegationPrompt({ handleCommand });
    const result = await prompt.admitVoiceDelegation({
      sessionId: 's1',
      instruction: '改成先修测试',
      callId: 'c1',
      providerDelegationId: 'd2',
      queue: true,
    });
    expect(result).toEqual({ queued: false, runId: 'run-live', messageId: 'voice-c1-d2' });
    expect(handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/steer',
        sessionId: 's1',
        message: '改成先修测试',
        clientMessageId: 'voice-c1-d2',
        source: 'voice-delegation',
        voiceCallId: 'c1',
      }),
    );
    expect(handleCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/queued-turn-submit' }),
    );
  });

  it('falls back to a queued turn when steer cannot attach', async () => {
    const handleCommand = vi.fn(async (command: { type: string }) => {
      if (command.type === 'session/steer') {
        return {
          type: 'response' as const,
          command: 'session/steer',
          success: false as const,
          error: 'no-active-run: session s1 has no foreground run',
        };
      }
      return {
        type: 'response' as const,
        command: 'session/queued-turn-submit',
        success: true as const,
        data: {},
      };
    });
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
  });

  it('aborts the current run for the stop protocol token', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/abort',
      success: true as const,
      data: { sessionId: 's1', runId: 'run-live', cancelled: true },
    }));
    const prompt = createHostVoiceDelegationPrompt({ handleCommand });
    const result = await prompt.admitVoiceDelegation({
      sessionId: 's1',
      instruction: 'STOP_CURRENT_RUN',
      callId: 'c1',
      providerDelegationId: 'd-stop',
      queue: true,
    });
    expect(result).toEqual({ queued: false, runId: 'run-live', messageId: 'voice-c1-d-stop' });
    expect(handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/abort', sessionId: 's1' }),
    );
    expect(handleCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/prompt' }),
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
