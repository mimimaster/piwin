import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, ModelRef } from '@piwin/contracts';
import { commitMobileComposerProfile } from './mobile-composer-profile.js';

const MODEL: ModelRef = { providerId: 'openai', modelId: 'gpt-4o' };

function successResponse(): HostResponse {
  return {
    type: 'response',
    command: 'session/set-composer-profile',
    success: true,
    data: { ok: true },
  };
}

describe('commitMobileComposerProfile', () => {
  it('does not request when sessionId is null', async () => {
    const request = vi.fn();
    const result = await commitMobileComposerProfile({
      request,
      sessionId: null,
      model: MODEL,
    });
    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('does not request when sessionId is undefined', async () => {
    const request = vi.fn();
    const result = await commitMobileComposerProfile({
      request,
      sessionId: undefined,
      thinkingLevel: 'low',
    });
    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('sends session/set-composer-profile when sessionId is set', async () => {
    const request = vi.fn(async (_command: HostCommand): Promise<HostResponse> =>
      successResponse(),
    );
    const result = await commitMobileComposerProfile({
      request,
      sessionId: 's1',
      model: MODEL,
      thinkingLevel: 'low',
    });
    expect(request).toHaveBeenCalledWith({
      type: 'session/set-composer-profile',
      sessionId: 's1',
      model: MODEL,
      thinkingLevel: 'low',
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false when Host fails', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/set-composer-profile',
      success: false,
      error: 'Unknown session: s1',
    }));
    const result = await commitMobileComposerProfile({
      request,
      sessionId: 's1',
      thinkingLevel: 'off',
    });
    expect(result).toEqual({ ok: false, error: 'Unknown session: s1' });
  });
});
