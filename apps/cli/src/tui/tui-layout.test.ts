import { Editor, TuiAltScreen, type Component } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import { mountTuiLayout } from './tui-layout.js';
import { TuiTestTerminal } from './tui-terminal.fixture.js';
import { editorTheme } from './tui-theme.js';

const lines = (text: () => string[]): Component => ({ render: text, invalidate: () => undefined });

describe('fixed TUI composer', () => {
  it('keeps the footer at the bottom with empty, long and scrolled history, then resize', async () => {
    const terminal = new TuiTestTerminal(80, 24);
    const tui = new TuiAltScreen(terminal);
    let history = ['empty conversation'];
    const scroll = mountTuiLayout(tui, {
      transcript: lines(() => history),
      activity: lines(() => []),
      editor: lines(() => ['composer']),
      status: lines(() => ['status']),
    });
    tui.start();
    try {
      await vi.waitFor(() => expect(terminal.screen.get(23)).toBe('composer'));
      expect(terminal.screen.get(24)).toBe('status');
      history = Array.from({ length: 60 }, (_, index) => `message ${index}`);
      tui.requestRender(true);
      await vi.waitFor(() => expect([...terminal.screen.values()]).toContain('message 59'));
      expect(terminal.screen.get(23)).toBe('composer');
      scroll?.scrollToStart();
      tui.requestRender();
      await vi.waitFor(() => expect(terminal.screen.get(1)).toBe('message 0'));
      expect(terminal.screen.get(23)).toBe('composer');
      history.push('new output while reading history');
      tui.requestRender();
      await vi.waitFor(() => expect(terminal.screen.get(1)).toBe('message 0'));
      terminal.resize(50, 12);
      await vi.waitFor(() => expect(terminal.screen.get(11)).toBe('composer'));
      expect(terminal.screen.get(12)).toBe('status');
    } finally {
      tui.stop();
    }
  });

  it('keeps a real multiline editor and its cursor visible in a short terminal', async () => {
    const terminal = new TuiTestTerminal(40, 6);
    const tui = new TuiAltScreen(terminal);
    const editor = new Editor(tui, editorTheme);
    mountTuiLayout(tui, {
      transcript: lines(() => ['history']),
      activity: lines(() => ['running']),
      editor,
      status: lines(() => ['status']),
    });
    tui.setFocus(editor);
    tui.start();
    try {
      editor.setText(Array.from({ length: 20 }, (_, index) => `draft ${index}`).join('\n'));
      tui.requestRender();
      await vi.waitFor(() => expect([...terminal.screen.values()]).toContain('draft 19'));
      expect(terminal.screen.get(6)).toBe('status');
      const cursor = [...terminal.output.matchAll(/\x1b\[(\d+);(\d+)H/g)].at(-1);
      expect(Number(cursor?.[1])).toBeLessThan(6);
    } finally {
      tui.stop();
    }
  });
});
