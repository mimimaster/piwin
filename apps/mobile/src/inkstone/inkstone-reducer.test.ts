import { describe, expect, it } from 'vitest';
import {
  INITIAL_INKSTONE_STATE,
  inkstoneReducer,
  OFFLINE_TOAST,
  type InkstoneState,
} from './demo-state.js';

function run(state: InkstoneState, action: Parameters<typeof inkstoneReducer>[1]): InkstoneState {
  return inkstoneReducer(state, action);
}

describe('inkstone demo reducer', () => {
  it('queues a draft while running and restores it on edit-queue', () => {
    const queued = run(
      { ...INITIAL_INKSTONE_STATE, run: 'running', draft: '继续修复' },
      { type: 'send' },
    );
    expect(queued.queue).toBe('继续修复');
    expect(queued.draft).toBe('');
    expect(queued.toast.message).toBe('已排到当前工作之后');

    const edited = run(queued, { type: 'edit-queue' });
    expect(edited.draft).toBe('继续修复');
    expect(edited.queue).toBe('');
  });

  it('pauses on empty send while running and resumes on the next empty send', () => {
    const paused = run({ ...INITIAL_INKSTONE_STATE, run: 'running' }, { type: 'send' });
    expect(paused.run).toBe('paused');

    const resumed = run(paused, { type: 'send' });
    expect(resumed.run).toBe('running');
  });

  it('sends a message when idle and attaches the attachment chip text', () => {
    const sent = run(
      { ...INITIAL_INKSTONE_STATE, run: 'idle', draft: '看看差异', attachment: 'session-notes.md' },
      { type: 'send' },
    );
    expect(sent.messages).toEqual(['看看差异 [session-notes.md]']);
    expect(sent.draft).toBe('');
    expect(sent.attachment).toBe('');
    expect(sent.run).toBe('running');
  });

  it('blocks decisions while offline but keeps drafting possible', () => {
    const offline = { ...INITIAL_INKSTONE_STATE, offline: true };
    const denied = run(offline, { type: 'permission', choice: 'approved', scope: 'once' });
    expect(denied.permission).toBe('pending');
    expect(denied.toast.message).toBe(OFFLINE_TOAST);

    const disconnected = run(offline, { type: 'disconnect' });
    expect(disconnected.route).toBe('chat');
  });

  it('executes the plan and switches scheme by execution mode', () => {
    const single = run({ ...INITIAL_INKSTONE_STATE }, { type: 'execute-plan', mode: 'single' });
    expect(single.planApproved).toBe(true);
    expect(single.scheme).toBe('单 Agent');
    expect(single.route).toBe('plan');

    const agents = run({ ...INITIAL_INKSTONE_STATE }, { type: 'execute-plan', mode: 'agents' });
    expect(agents.scheme).toBe('Ultra Code');
  });

  it('runs the review card loop through flip and rate until completion', () => {
    let state = INITIAL_INKSTONE_STATE;
    state = run(state, { type: 'flip-card' });
    expect(state.cardFlipped).toBe(true);
    state = run(state, { type: 'rate-card', rating: '记得' });
    expect(state.studied).toBe(1);
    expect(state.cardFlipped).toBe(false);

    const completed = run({ ...INITIAL_INKSTONE_STATE, studied: 12 }, { type: 'flip-card' });
    expect(completed.studied).toBe(12);
  });

  it('persists demo form values per sheet and closes the sheet', () => {
    const saved = run(INITIAL_INKSTONE_STATE, {
      type: 'open-sheet',
      key: 'goal',
    });
    const withValues = run(saved, {
      type: 'save-demo',
      values: { 'goal-title': '走查通过' },
      message: '目标已显示在当前演示中',
    });
    expect(withValues.sheet).toBeNull();
    expect(withValues.formDrafts['goal']).toEqual({ 'goal-title': '走查通过' });
    expect(withValues.toast.message).toBe('目标已显示在当前演示中');
  });

  it('rejects unknown sheets with the prototype toast', () => {
    const state = run(INITIAL_INKSTONE_STATE, { type: 'open-sheet', key: 'nope' });
    expect(state.sheet).toBeNull();
    expect(state.toast.message).toBe('这个入口的演示暂未定义');
  });
});
