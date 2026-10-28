/**
 * Keys a phone keyboard lacks, under a touch terminal (ADR 0102). The app
 * shell already shrinks to the visible viewport while the keyboard is up, so
 * the bar sits right above it without tracking the keyboard itself.
 */
import type { PointerEvent, ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { terminalBarKeySequence, type TerminalBarKey } from './terminal-key-sequences';

export type TerminalKeyBarProps = {
  locale: DesktopLocale;
  ctrlArmed: boolean;
  onCtrlChange: (armed: boolean) => void;
  onSend: (data: string) => void;
};

type BarKey = { key: TerminalBarKey; glyph: string; zh: string; en: string };

const KEYS: readonly BarKey[] = [
  { key: 'escape', glyph: 'Esc', zh: 'Esc', en: 'Escape' },
  { key: 'tab', glyph: 'Tab', zh: 'Tab', en: 'Tab' },
  { key: 'left', glyph: '←', zh: '左', en: 'Left' },
  { key: 'up', glyph: '↑', zh: '上', en: 'Up' },
  { key: 'down', glyph: '↓', zh: '下', en: 'Down' },
  { key: 'right', glyph: '→', zh: '右', en: 'Right' },
  { key: 'slash', glyph: '/', zh: '斜杠', en: 'Slash' },
];

/** A tap on the bar must not take focus from the terminal and drop the keyboard. */
function keepTerminalFocus(event: PointerEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

export function TerminalKeyBar(props: TerminalKeyBarProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const press = (key: TerminalBarKey): void => {
    props.onSend(terminalBarKeySequence(key, props.ctrlArmed));
    if (props.ctrlArmed) props.onCtrlChange(false);
  };
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      props.onSend(text);
    } catch (error) {
      // Declined or unavailable clipboard: nothing to paste, nothing to report.
      console.warn('[terminal] clipboard read failed', error);
    }
  };
  return (
    <div className="terminal-key-bar" role="toolbar" aria-label={zh ? '终端按键' : 'Terminal keys'} data-testid="terminal-key-bar">
      <Button
        variant="ghost"
        size="compact"
        className="terminal-key-bar-key"
        aria-pressed={props.ctrlArmed}
        data-testid="terminal-key-ctrl"
        onPointerDown={keepTerminalFocus}
        onClick={() => props.onCtrlChange(!props.ctrlArmed)}
      >
        Ctrl
      </Button>
      {KEYS.map((entry) => (
        <Button
          key={entry.key}
          variant="ghost"
          size="compact"
          className="terminal-key-bar-key"
          aria-label={zh ? entry.zh : entry.en}
          data-testid={`terminal-key-${entry.key}`}
          onPointerDown={keepTerminalFocus}
          onClick={() => press(entry.key)}
        >
          {entry.glyph}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="compact"
        className="terminal-key-bar-key"
        data-testid="terminal-key-paste"
        onPointerDown={keepTerminalFocus}
        onClick={() => { void paste(); }}
      >
        {zh ? '粘贴' : 'Paste'}
      </Button>
    </div>
  );
}
