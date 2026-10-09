import { describe, expect, it } from 'vitest';
import { TurnNotifier } from './turn-notifier.js';

function setup(env: NodeJS.ProcessEnv = {}) {
  const written: string[] = [];
  let now = 1_000_000;
  const notifier = new TurnNotifier({ write: (data) => written.push(data), env, now: () => now, minRunMs: 10_000 });
  return { notifier, written, advance: (ms: number) => (now += ms) };
}

describe('TurnNotifier', () => {
  it('stays quiet for a turn short enough to have been watched', () => {
    const { notifier, written, advance } = setup();
    notifier.observeRunning(true);
    advance(3_000);
    notifier.observeRunning(false);
    expect(written).toEqual([]);
  });

  it('rings once when a long turn finishes', () => {
    const { notifier, written, advance } = setup();
    notifier.observeRunning(true);
    advance(5_000);
    notifier.observeRunning(true);
    advance(8_000);
    notifier.observeRunning(false);
    notifier.observeRunning(false);
    expect(written).toEqual(['\x07']);
  });

  it('adds a desktop notification in a terminal that shows one', () => {
    const { notifier, written } = setup({ TERM_PROGRAM: 'ghostty' });
    notifier.attention('需要你确认');
    expect(written).toEqual(['\x07\x1b]9;piwin：需要你确认\x07']);
  });

  it('can be told to use one signal, or none', () => {
    const osc9 = setup({ PIWIN_TUI_NOTIFY: 'osc9' });
    osc9.notifier.attention('x');
    expect(osc9.written).toEqual(['\x1b]9;piwin：x\x07']);
    const bell = setup({ PIWIN_TUI_NOTIFY: 'bell', TERM_PROGRAM: 'ghostty' });
    bell.notifier.attention('x');
    expect(bell.written).toEqual(['\x07']);
    const off = setup({ PIWIN_TUI_NOTIFY: 'off' });
    off.notifier.attention('x');
    expect(off.written).toEqual([]);
  });

  it('does not let message text end the escape sequence early', () => {
    const { notifier, written } = setup({ PIWIN_TUI_NOTIFY: 'osc9' });
    notifier.attention('a\x07b\x1b[31m');
    expect(written[0]).toBe('\x1b]9;piwin：a b [31m\x07');
  });
});
