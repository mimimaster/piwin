import { describe, expect, it, vi } from 'vitest';
import { PIWIN_LIVE_STOP_INSTRUCTION, type LiveDelegationReviewInput } from '@piwin/contracts';
import { createLiveDelegationReviewer, LIVE_DELEGATION_REVIEW_PROMPT, LiveDelegationReviewError } from './delegation-review.js';

const request: LiveDelegationReviewInput = {
  sessionId: 'session', instruction: '做一个骑车动画，不要日落背景',
  tasks: [{ delegationId: 'original', brief: '制作骑车动画', status: 'completed', result: '已生成代码' }],
  signal: new AbortController().signal,
};

describe('tool-free voice intent reviewer', () => {
  it('passes candidate and completed-task context as data, retaining negative constraints', async () => {
    const complete = vi.fn<Parameters<typeof createLiveDelegationReviewer>[0]['complete']>(async () => JSON.stringify({ kind: 'work', brief: request.instruction }));
    const decision = await createLiveDelegationReviewer({ complete })(request);
    expect(decision).toEqual({ kind: 'work', brief: request.instruction });
    const input = complete.mock.calls[0]?.[0];
    expect(input).toMatchObject({ systemPrompt: LIVE_DELEGATION_REVIEW_PROMPT, sessionId: 'session' });
    expect(JSON.parse(input?.userPrompt ?? '{}')).toEqual({
      instruction: request.instruction,
      tasks: request.tasks,
      recentTurns: [],
    });
    expect(input).not.toHaveProperty('tools');
  });

  it('includes recent session turns so a follow-up can resolve as work', async () => {
    const complete = vi.fn<Parameters<typeof createLiveDelegationReviewer>[0]['complete']>(
      async () => JSON.stringify({ kind: 'work', brief: '把动画改成白天' }),
    );
    const decision = await createLiveDelegationReviewer({ complete })({
      ...request,
      instruction: '改成白天',
      recentTurns: [{ role: 'user', text: '做一个骑车的HTML动画' }],
    });
    expect(decision).toEqual({ kind: 'work', brief: '把动画改成白天' });
    const payload = complete.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(JSON.parse(payload?.userPrompt ?? '{}').recentTurns).toEqual([
      { role: 'user', text: '做一个骑车的HTML动画' },
    ]);
  });

  it.each([
    { kind: 'conversation' }, { kind: 'clarify' }, { kind: 'stop' },
    { kind: 'reuse', delegationId: 'original' }, { kind: 'repeat', brief: '再做一个骑车动画' },
  ])('accepts a valid $kind decision', async (decision) => {
    expect(await createLiveDelegationReviewer({ complete: async () => JSON.stringify(decision) })(request)).toEqual(decision);
  });

  it.each([
    'not JSON', '```json\n{"kind":"work","brief":"run"}\n```', 'null', '[]',
    '{"kind":"reuse","delegationId":"invented"}', '{"kind":"work","brief":""}',
    '{"kind":"conversation","brief":"run"}', '{"kind":"execute","brief":"run"}',
    '{"kind":"work","brief":"run","tools":["shell"]}',
  ])('fails closed on malformed/overprivileged output: %s', async (output) => {
    await expect(createLiveDelegationReviewer({ complete: async () => output })(request)).rejects.toBeInstanceOf(LiveDelegationReviewError);
  });

  it('does not call a model for filler, a protocol stop or an aborted call', async () => {
    const complete = vi.fn(async () => '{"kind":"work","brief":"unexpected"}');
    const review = createLiveDelegationReviewer({ complete });
    expect(await review({ ...request, instruction: '嗯' })).toEqual({ kind: 'conversation' });
    expect(await review({ ...request, instruction: PIWIN_LIVE_STOP_INSTRUCTION })).toEqual({ kind: 'stop' });
    await expect(review({ ...request, signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it('discards a late model decision after abort', async () => {
    const controller = new AbortController();
    const review = createLiveDelegationReviewer({ complete: async () => {
      controller.abort();
      return '{"kind":"work","brief":"late"}';
    } });
    await expect(review({ ...request, signal: controller.signal })).rejects.toBeDefined();
  });
});
