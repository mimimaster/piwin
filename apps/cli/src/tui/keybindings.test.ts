import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, formatKey, parseKeyId, resolveKeybindings, shortcutHelp } from './keybindings.js';

describe('parseKeyId', () => {
  it('accepts modified letters, shift+tab and function keys, in any case', () => {
    expect(parseKeyId('Ctrl+T')).toEqual({ key: 'ctrl+t' });
    expect(parseKeyId('alt+r')).toEqual({ key: 'alt+r' });
    expect(parseKeyId('shift+tab')).toEqual({ key: 'shift+tab' });
    expect(parseKeyId('f2')).toEqual({ key: 'f2' });
  });

  it('refuses a bare letter, which would swallow typing', () => {
    expect(parseKeyId('r')).toMatchObject({ error: expect.stringContaining('修饰键') });
  });

  it('refuses nonsense and repeated modifiers', () => {
    expect(parseKeyId('ctrl+ctrl+s')).toHaveProperty('error');
    expect(parseKeyId('hyper+s')).toHaveProperty('error');
    expect(parseKeyId('ctrl+')).toHaveProperty('error');
  });

  it('refuses keys the editor or exit needs', () => {
    expect(parseKeyId('ctrl+c')).toMatchObject({ error: expect.stringContaining('不能重新绑定') });
    expect(parseKeyId('ctrl+u')).toHaveProperty('error');
  });
});

describe('resolveKeybindings', () => {
  it('uses the defaults for no file', () => {
    expect(resolveKeybindings(undefined)).toEqual({ bindings: DEFAULT_KEYBINDINGS, problems: [] });
  });

  it('applies a valid override and keeps the rest', () => {
    const { bindings, problems } = resolveKeybindings({ sessions: 'alt+s', history: 'F3' });
    expect(problems).toEqual([]);
    expect(bindings).toMatchObject({ sessions: 'alt+s', history: 'f3', editor: 'ctrl+g' });
  });

  it('reports a bad entry and keeps that action’s default', () => {
    const { bindings, problems } = resolveKeybindings({ sessions: 'ctrl+c', nope: 'ctrl+x', editor: 7 });
    expect(bindings).toEqual(DEFAULT_KEYBINDINGS);
    expect(problems).toHaveLength(3);
  });

  it('reports two actions on one key and puts the later one back', () => {
    const { bindings, problems } = resolveKeybindings({ history: 'alt+x', editor: 'alt+x' });
    expect(bindings.history).toBe('alt+x');
    expect(bindings.editor).toBe('ctrl+g');
    expect(problems[0]).toContain('editor 和 history 都绑在 alt+x');
  });

  it('rejects a file that is not an object', () => {
    expect(resolveKeybindings(['ctrl+s']).bindings).toEqual(DEFAULT_KEYBINDINGS);
    expect(resolveKeybindings('x').problems).toHaveLength(1);
  });
});

describe('formatKey', () => {
  it('writes keys the way the help text does', () => {
    expect([formatKey('ctrl+s'), formatKey('shift+tab'), formatKey('f2'), formatKey('alt+r')]).toEqual(['Ctrl+S', 'Shift+Tab', 'F2', 'Alt+R']);
  });
});

describe('shortcutHelp', () => {
  it('names the keys that are bound, not the defaults', () => {
    const help = shortcutHelp({ ...DEFAULT_KEYBINDINGS, history: 'alt+r' });
    expect(help).toContain('Alt+R 历史提示词');
    expect(help).not.toContain('Ctrl+R');
    expect(help).toContain('Ctrl+S 会话');
  });
});
