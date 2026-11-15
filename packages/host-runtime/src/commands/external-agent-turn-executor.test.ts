import { describe, expect, it, vi } from 'vitest';
import type { ExecutionRunRecord, SessionTranscriptMessage } from '@piwin/contracts';
import { TURN_CONTINUATION_PROMPT, type PromptCommand } from './prompt-preparation.js';
import { buildExternalAgentPrompt, executeExternalAgentTurn } from './external-agent-turn-executor.js';
import type { SessionLiveContext } from './session-live-context.js';

describe('buildExternalAgentPrompt', () => {
  it('forwards media attachments without putting paths into the text', () => {
    const prompt = buildExternalAgentPrompt({
      text: 'what is this',
      attachments: [
        {
          id: 'img-1',
          kind: 'media',
          path: '/media/shot.png',
          mimeType: 'image/png',
          byteSize: 12,
          source: 'paste',
        },
      ],
    });
    expect(prompt.text).toBe('what is this');
    expect(prompt.text).not.toContain('/media/shot.png');
    expect(prompt.attachments).toEqual([
      {
        id: 'img-1',
        kind: 'media',
        path: '/media/shot.png',
        mimeType: 'image/png',
        byteSize: 12,
        source: 'paste',
      },
    ]);
  });

  it('does not invent a continuation user row payload', () => {
    const prompt = buildExternalAgentPrompt({
      text: 'ignored',
      source: 'continuation',
    });
    expect(prompt.text).toBe(TURN_CONTINUATION_PROMPT);
    expect(prompt.attachments).toBeUndefined();
  });
});

describe('executeExternalAgentTurn', () => {
  it('restores stored user prompt on retry instead of sending empty text', async () => {
    const storedUserMessage: SessionTranscriptMessage = {
      id: 'user-msg-1',
      role: 'user',
      text: 'Original prompt text to retry',
      status: 'done',
      createdAt: '2026-11-12T00:00:00.000Z',
      attachments: [
        {
          id: 'att-1',
          kind: 'media',
          path: '/media/photo.png',
          mimeType: 'image/png',
          byteSize: 100,
          source: 'paste',
        },
      ],
    };

    const promptMock = vi.fn().mockResolvedValue({ status: 'completed' });
    const touchSessionMock = vi.fn().mockResolvedValue(undefined);
    const terminateRunMock = vi.fn().mockResolvedValue(undefined);

    const context = {
      getRunSignal: vi.fn().mockReturnValue(undefined),
      getTranscriptStore: vi.fn().mockResolvedValue({
        getMessage: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'user-msg-1') return storedUserMessage;
          return undefined;
        }),
      }),
      beginTurnChangeRun: vi.fn(),
      activateSessionRuntime: vi.fn().mockResolvedValue({
        prompt: promptMock,
      }),
      updateRunPhase: vi.fn(),
      applySessionOutcome: vi.fn().mockReturnValue('completed'),
      touchSession: touchSessionMock,
      terminateRun: terminateRunMock,
      push: vi.fn(),
    } as unknown as SessionLiveContext;

    const command: PromptCommand = {
      type: 'session/prompt',
      sessionId: 'session-external-1',
      input: {
        text: '',
        retryUserMessageId: 'user-msg-1',
      },
    };

    const run: ExecutionRunRecord = {
      runId: 'run-1',
      kind: 'session-turn',
      status: 'running',
      rootRunId: 'run-1',
      sessionId: 'session-external-1',
      phase: 'accepted',
    };

    await executeExternalAgentTurn({
      context,
      command,
      run,
      supersededRun: undefined,
    });

    expect(promptMock).toHaveBeenCalledWith({
      text: 'Original prompt text to retry',
      attachments: storedUserMessage.attachments,
    });
    expect(touchSessionMock).toHaveBeenCalledWith(
      'session-external-1',
      'Original prompt text to retry',
    );
    expect(terminateRunMock).toHaveBeenCalledWith(
      'session-external-1',
      'run-1',
      'completed',
      undefined,
      undefined,
      { agentStopReason: undefined },
    );
  });
});
