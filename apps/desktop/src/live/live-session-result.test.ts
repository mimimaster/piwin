import { describe, expect, it } from 'vitest';
import { canFeedLiveSessionResult, readDelegatedTurnResult } from './live-session-result.js';

describe('live session result feed', () => {
  it('reads the assistant after the latest voice delegation', () => {
    expect(
      readDelegatedTurnResult([
        { id: 'a0', role: 'assistant', text: '旧回复', status: 'done' },
        { id: 'u1', role: 'user', text: '今天加州的天气怎么样', status: 'done' },
        { id: 'a1', role: 'assistant', text: '洛杉矶晴', status: 'done', tools: [] },
      ]),
    ).toEqual({
      messageId: 'a1',
      text: '洛杉矶晴',
      done: true,
      toolsRunning: false,
    });
  });

  it('waits until that delegated turn is finished', () => {
    expect(
      canFeedLiveSessionResult({
        activity: 'agent-working',
        sessionStreaming: false,
        assistant: { messageId: 'a2', text: '洛杉矶晴', done: true, toolsRunning: false },
      }),
    ).toBe(true);
    expect(
      canFeedLiveSessionResult({
        activity: 'agent-working',
        sessionStreaming: true,
        assistant: { messageId: 'a2', text: '洛杉矶晴', done: false, toolsRunning: true },
      }),
    ).toBe(false);
    expect(
      canFeedLiveSessionResult({
        activity: 'listening',
        sessionStreaming: false,
        assistant: { messageId: 'a2', text: '洛杉矶晴', done: true, toolsRunning: false },
      }),
    ).toBe(false);
  });
});
