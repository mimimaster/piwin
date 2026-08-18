import { describe, expect, it, vi } from 'vitest';
import type { ForegroundRunMismatchProblem, HostProblem, HostResponse } from '@piwin/contracts';
import {
  canConfirmReplaceRun,
  canSendForegroundPrompt,
  foregroundMismatchNotice,
  hostSupportsForegroundAdmission,
  nextPromptForeground,
  readForegroundProblem,
  requestPromptWithForeground,
  supersededByNewPromptNotice,
} from './prompt-foreground';

function failResponse(problem?: HostProblem): HostResponse {
  return {
    type: 'response',
    command: 'session/prompt',
    success: false,
    error: 'foreground-run-mismatch: active',
    ...(problem === undefined ? {} : { problem }),
  };
}

function okResponse(runId: string): HostResponse {
  return {
    type: 'response',
    command: 'session/prompt',
    success: true,
    data: { sessionId: 's1', runId, acceptedAt: '2026-08-13T00:00:00.000Z' },
  };
}

const activeProblem: ForegroundRunMismatchProblem = {
  code: 'foreground-run-mismatch',
  data: {
    reason: 'active',
    actualRun: { runId: 'run-phone', status: 'running' },
  },
};

describe('nextPromptForeground', () => {
  it('returns if-idle unless the user just confirmed a runId', () => {
    expect(nextPromptForeground({})).toEqual({ kind: 'if-idle' });
    expect(nextPromptForeground({ confirmedReplaceRunId: '   ' })).toEqual({ kind: 'if-idle' });
  });

  it('returns replace-run only for a confirmed runId', () => {
    expect(nextPromptForeground({ confirmedReplaceRunId: 'run-phone' })).toEqual({
      kind: 'replace-run',
      runId: 'run-phone',
    });
  });
});

describe('readForegroundProblem', () => {
  it('returns undefined for a successful prompt ack', () => {
    expect(readForegroundProblem(okResponse('run-1'))).toBeUndefined();
  });

  it('returns undefined when the failure has no structured problem', () => {
    expect(readForegroundProblem(failResponse())).toBeUndefined();
  });

  it('returns undefined for a different problem code', () => {
    expect(
      readForegroundProblem(
        failResponse({ code: 'command-not-allowed', data: { reason: 'active' } }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when mismatch data is malformed', () => {
    expect(
      readForegroundProblem(failResponse({ code: 'foreground-run-mismatch', data: { reason: 'busy' } })),
    ).toBeUndefined();
  });

  it('parses a typed foreground-run-mismatch problem', () => {
    expect(readForegroundProblem(failResponse(activeProblem))).toEqual(activeProblem);
  });

  it('parses a projected remote payload with runId-only actualRun', () => {
    const projected = {
      code: 'foreground-run-mismatch' as const,
      data: { reason: 'active' as const, actualRun: { runId: 'run-live' } },
    };
    const problem = readForegroundProblem(failResponse(projected));
    expect(problem).toEqual({
      code: 'foreground-run-mismatch',
      data: { reason: 'active', actualRun: { runId: 'run-live' } },
    });
    expect(problem !== undefined && canConfirmReplaceRun(problem)).toBe(true);
  });

  it('falls back to data.runId when actualRun is omitted', () => {
    const problem = readForegroundProblem(
      failResponse({
        code: 'foreground-run-mismatch',
        data: { reason: 'active', runId: 'run-from-data' },
      }),
    );
    expect(problem?.data.actualRun?.runId).toBe('run-from-data');
    expect(problem !== undefined && canConfirmReplaceRun(problem)).toBe(true);
  });
});

describe('canConfirmReplaceRun', () => {
  it('is true only for active/transitioning with an actual runId', () => {
    expect(canConfirmReplaceRun(activeProblem)).toBe(true);
    expect(
      canConfirmReplaceRun({
        code: 'foreground-run-mismatch',
        data: { reason: 'transitioning', actualRun: { runId: 'run-a', status: 'cancelling' } },
      }),
    ).toBe(true);
    expect(
      canConfirmReplaceRun({
        code: 'foreground-run-mismatch',
        data: { reason: 'already-finished' },
      }),
    ).toBe(false);
    expect(
      canConfirmReplaceRun({
        code: 'foreground-run-mismatch',
        data: { reason: 'changed', actualRun: { runId: 'run-b', status: 'running' } },
      }),
    ).toBe(false);
    expect(
      canConfirmReplaceRun({
        code: 'foreground-run-mismatch',
        data: { reason: 'active' },
      }),
    ).toBe(false);
  });
});

describe('requestPromptWithForeground', () => {
  it('sends if-idle and retries once with replace-run after confirm', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(failResponse(activeProblem))
      .mockResolvedValueOnce(okResponse('run-desktop'));
    const confirmReplace = vi.fn().mockResolvedValue(true);

    const response = await requestPromptWithForeground({
      request,
      sessionId: 's1',
      input: { text: 'hello' },
      confirmReplace,
    });

    expect(response.success).toBe(true);
    expect(confirmReplace).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'session/prompt',
      sessionId: 's1',
      foreground: { kind: 'if-idle' },
    });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      type: 'session/prompt',
      sessionId: 's1',
      foreground: { kind: 'replace-run', runId: 'run-phone' },
      input: { text: 'hello' },
    });
    expect(request.mock.calls[0]?.[0]).not.toBe(request.mock.calls[1]?.[0]);
  });

  it('retries replace-run from a projected remote { actualRun: { runId } } payload', async () => {
    const projected = {
      code: 'foreground-run-mismatch' as const,
      data: { reason: 'active' as const, actualRun: { runId: 'run-live' } },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(failResponse(projected))
      .mockResolvedValueOnce(okResponse('run-desktop'));
    const confirmReplace = vi.fn().mockResolvedValue(true);

    const response = await requestPromptWithForeground({
      request,
      sessionId: 's1',
      input: { text: 'hello' },
      confirmReplace,
    });

    expect(response.success).toBe(true);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      foreground: { kind: 'replace-run', runId: 'run-live' },
    });
  });

  it('does not auto-replace already-finished or changed mismatches', async () => {
    const request = vi.fn().mockResolvedValue(
      failResponse({
        code: 'foreground-run-mismatch',
        data: { reason: 'already-finished' },
      }),
    );
    const confirmReplace = vi.fn().mockResolvedValue(true);

    const response = await requestPromptWithForeground({
      request,
      sessionId: 's1',
      input: { text: 'hello' },
      confirmReplace,
    });

    expect(response.success).toBe(false);
    expect(confirmReplace).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({ foreground: { kind: 'if-idle' } });
  });

  it('leaves send as if-idle when the user cancels the confirm sheet', async () => {
    const request = vi.fn().mockResolvedValue(failResponse(activeProblem));
    const response = await requestPromptWithForeground({
      request,
      sessionId: 's1',
      input: { text: 'hello' },
      confirmReplace: async () => false,
    });

    expect(response.success).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({ foreground: { kind: 'if-idle' } });
  });

  it('does not silently replace from Side Chat / queued drain', async () => {
    const request = vi.fn().mockResolvedValue(failResponse(activeProblem));
    const confirmReplace = vi.fn().mockResolvedValue(true);

    await requestPromptWithForeground({
      request,
      sessionId: 'side-1',
      input: { text: 'question' },
      confirmReplace,
      allowReplaceConfirm: false,
    });

    expect(confirmReplace).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not send when remote hello lacks foregroundRunAdmission', async () => {
    const request = vi.fn();
    const response = await requestPromptWithForeground({
      request,
      sessionId: 's1',
      input: { text: 'hello' },
      remoteForegroundAdmission: false,
    });
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.problem?.code).toBe('host-too-old');
    }
    expect(request).not.toHaveBeenCalled();
  });
});

describe('notice copy', () => {
  it('uses the specified confirm copy for an active remote run', () => {
    expect(foregroundMismatchNotice(activeProblem, 'zh-CN')).toBe(
      '另一端正在处理这个会话，发送会中断当前任务',
    );
    expect(foregroundMismatchNotice(activeProblem, 'en')).toMatch(/interrupt/i);
  });

  it('does not treat already-finished / changed as a crash', () => {
    expect(
      foregroundMismatchNotice(
        { code: 'foreground-run-mismatch', data: { reason: 'already-finished' } },
        'zh-CN',
      ),
    ).toMatch(/已经结束|已结束/);
    expect(
      foregroundMismatchNotice(
        { code: 'foreground-run-mismatch', data: { reason: 'changed' } },
        'zh-CN',
      ),
    ).toMatch(/已切换|已变化/);
  });

  it('renders superseded-by-new-prompt from the stable code', () => {
    expect(supersededByNewPromptNotice('zh-CN')).toBe('任务被另一台设备发送的新消息中断');
    expect(supersededByNewPromptNotice('en')).toMatch(/another device/i);
  });
});

describe('canSendForegroundPrompt', () => {
  it('allows local sidecar and mock even without the hello flag', () => {
    expect(canSendForegroundPrompt({ transport: 'live' })).toBe(true);
    expect(canSendForegroundPrompt({ transport: 'mock' })).toBe(true);
    expect(hostSupportsForegroundAdmission(undefined)).toBe(false);
  });

  it('blocks remote prompts when hello lacks foregroundRunAdmission', () => {
    expect(canSendForegroundPrompt({ transport: 'remote' })).toBe(false);
    expect(
      canSendForegroundPrompt({
        transport: 'remote',
        capabilities: {
          pushSequencing: true,
          replay: true,
          snapshot: true,
          sessionRead: true,
          sessionControl: true,
          permissionResolve: true,
          mediaUpload: true,
        },
      }),
    ).toBe(false);
  });

  it('allows remote prompts when the Host advertises the flag', () => {
    expect(
      canSendForegroundPrompt({
        transport: 'remote',
        capabilities: {
          pushSequencing: true,
          replay: true,
          snapshot: true,
          sessionRead: true,
          sessionControl: true,
          permissionResolve: true,
          mediaUpload: true,
          foregroundRunAdmission: true,
        },
      }),
    ).toBe(true);
  });
});
