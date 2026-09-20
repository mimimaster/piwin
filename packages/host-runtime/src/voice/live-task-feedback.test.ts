import { describe, expect, it } from 'vitest';
import {
  renderLiveNoWorkFeedback,
  renderLiveTaskReuseFeedback,
  renderLiveTaskStatusRefresh,
} from './live-task-feedback.js';

describe('renderLiveNoWorkFeedback', () => {
  it.each([
    'conversation',
    'clarify',
    'unavailable',
    'hold-empty',
    'hold-mismatch',
  ] as const)('scopes %s rejection to the current utterance', (reason) => {
    const content = renderLiveNoWorkFeedback(reason);
    expect(content).toContain('This utterance did not create a new task');
    expect(content).not.toContain('No work started');
  });
});

describe('renderLiveTaskStatusRefresh', () => {
  it.each([
    ['queued', undefined, 'accepted and queued', 'waiting to run'],
    ['working', undefined, 'did start and is currently running', 'currently running'],
    ['completed', '完成结果', 'did run and is completed', 'did run'],
    ['incomplete', '未完成结果', 'did run but is incomplete', 'incomplete'],
  ] as const)('renders authoritative %s state', (status, result, expected, detail) => {
    const content = renderLiveTaskStatusRefresh({
      delegationId: 'd1',
      brief: '任务',
      status,
      ...(result ? { result } : {}),
    });
    expect(content).toContain(expected);
    expect(content).toContain(detail);
    expect(content).toContain('Do not contradict it');
    if (result) expect(content).toContain(result);
  });
});

describe('renderLiveTaskReuseFeedback', () => {
  it('distinguishes queued, running, and terminal tasks', () => {
    expect(renderLiveTaskReuseFeedback({ queued: true })).toContain('waiting to run');
    expect(renderLiveTaskReuseFeedback({ queued: false })).toContain('did start');
    expect(renderLiveTaskReuseFeedback({ queued: false, result: '完成' })).toContain('完成');
  });
});
