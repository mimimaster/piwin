import type { QueuedTurnRecord, RunInterventionRecord } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { QueueStrip, renderStrip, stripRows } from './queue-strip.js';
import { handleQueueStripKey } from './queue-strip-keys.js';
import { queued, steer } from './queue-strip.fixture.js';

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('queue strip rows', () => {
  it('lists steers first, then queued turns numbered, with attachments and replace turns labelled', () => {
    const rows = stripRows(
      [
        queued('q1', '再跑一遍  lint', { input: { text: '再跑一遍  lint', attachments: [{ kind: 'media', id: 'm' } as never] } }),
        queued('q2', '改成替换', { mode: 'replace' }),
        queued('q3', '最后一条'),
      ],
      [steer('i1', 'pending'), steer('i2', 'applied')],
    );
    expect(rows.map((row) => row.line)).toEqual([
      '↳ 插入中: 先看测试 (等待)',
      '⏳ 已排队 1: 再跑一遍 lint [附件 1]',
      '⇄ 替换当前回合: 改成替换',
      '⏳ 已排队 2: 最后一条',
    ]);
  });

  it('cuts long text at about 60 columns', () => {
    const [row] = stripRows([queued('q1', 'x'.repeat(200))], []);
    expect(row?.line).toBe(`⏳ 已排队 1: ${'x'.repeat(59)}…`);
  });

  it('shows three rows, then how many more, and marks failed steers', () => {
    const rows = stripRows([queued('q1', 'a'), queued('q2', 'b'), queued('q3', 'c')], [steer('i1', 'expired')]);
    const lines = renderStrip(rows, 80, { focused: false, selected: 0 }).map(strip);
    expect(lines).toEqual([
      '  ↳ 插入中: 先看测试 (已过期)',
      '  ⏳ 已排队 1: a',
      '  ⏳ 已排队 2: b',
      '  … 还有 1 条',
      '  Alt+↑ 管理',
    ]);
    expect(renderStrip(rows, 80, { focused: false, selected: 0 })[0]).toContain('\x1b[31m');
    expect(renderStrip([], 80, { focused: false, selected: 0 })).toEqual([]);
  });

  it('follows the selection past the third row and names the keys', () => {
    const rows = stripRows([queued('q1', 'a'), queued('q2', 'b'), queued('q3', 'c'), queued('q4', 'd')], []);
    const lines = renderStrip(rows, 80, { focused: true, selected: 3 }).map(strip);
    expect(lines[2]).toBe('› ⏳ 已排队 4: d');
    expect(lines.at(-1)).toContain('Enter 现在插入 · E 取回编辑 · Del 取消');
  });
});

describe('queue strip keys', () => {
  function setup(turns: QueuedTurnRecord[], steers: RunInterventionRecord[] = []) {
    const view = new QueueStrip(() => stripRows(turns, steers));
    const actions = {
      queue: { steerNow: vi.fn(async () => {}), editTurn: vi.fn(async () => {}), cancel: vi.fn(async () => {}) },
      interventions: { cancel: vi.fn(async () => {}), requeue: vi.fn(async () => {}) },
      refresh: vi.fn(),
      onError: vi.fn(),
    };
    const press = (data: string, focus = false) => handleQueueStripKey(view, data, focus, actions);
    return { view, actions, press };
  }

  it('ignores keys until Alt+↑ focuses it, and does nothing when empty', () => {
    expect(setup([]).press('\x1b[1;3A', true)).toBe(false);
    const { view, press } = setup([queued('q1', 'a')]);
    expect(press('x')).toBe(false);
    expect(press('\x1b[1;3A', true)).toBe(true);
    expect(view.focused).toBe(true);
  });

  it('steers, edits and cancels the selected queued turn', () => {
    const turns = [queued('q1', 'a'), queued('q2', 'b')];
    const { actions, press, view } = setup(turns);
    press('', true);
    press('\x1b[B');
    press('\r');
    expect(actions.queue.steerNow).toHaveBeenCalledWith(turns[1]);
    press('\x1b[3~');
    expect(actions.queue.cancel).toHaveBeenCalledWith(turns[1]);
    press('e');
    expect(actions.queue.editTurn).toHaveBeenCalledWith(turns[1]);
    expect(view.focused).toBe(false);
  });

  it('re-queues a failed steer on Enter and lets Esc go back to typing', () => {
    const failed = steer('i1', 'failed');
    const { actions, press, view } = setup([], [failed]);
    press('', true);
    press('\r');
    expect(actions.interventions.requeue).toHaveBeenCalledWith(failed);
    press('\x1b');
    expect(view.focused).toBe(false);
  });
});
