import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editTextExternally, type ExternalEditorRun } from './external-editor.js';

/** An "editor" that replaces the file's content, like a person saving a rewrite. */
const savingAs = (content: string, seen?: { args: string[]; before: string }): ExternalEditorRun => (command, args) => {
  const file = args[args.length - 1] ?? '';
  if (seen !== undefined) {
    seen.args = [command, ...args.slice(0, -1)];
    seen.before = readFileSync(file, 'utf8');
  }
  writeFileSync(file, content);
  return { status: 0 };
};

describe('editTextExternally', () => {
  it('hands the editor the current text and returns what was saved, minus the editor’s final newline', () => {
    const seen = { args: [] as string[], before: '' };
    const result = editTextExternally('draft', { env: { EDITOR: 'nano' }, run: savingAs('rewritten\nin two lines\n', seen) });
    expect(result).toEqual({ kind: 'edited', text: 'rewritten\nin two lines' });
    expect(seen).toEqual({ args: ['nano'], before: 'draft' });
  });

  it('prefers $VISUAL and passes the editor’s own arguments', () => {
    const seen = { args: [] as string[], before: '' };
    editTextExternally('x', { env: { VISUAL: 'code --wait', EDITOR: 'nano' }, run: savingAs('x', seen) });
    expect(seen.args).toEqual(['code', '--wait']);
  });

  it('falls back to vi', () => {
    const seen = { args: [] as string[], before: '' };
    editTextExternally('x', { env: {}, run: savingAs('x', seen) });
    expect(seen.args).toEqual(['vi']);
  });

  it('reports no change when the text comes back the same', () => {
    expect(editTextExternally('same', { env: { EDITOR: 'e' }, run: savingAs('same\n') })).toEqual({ kind: 'unchanged' });
  });

  it('keeps the composer when the editor exits with an error', () => {
    const result = editTextExternally('keep me', { env: { EDITOR: 'e' }, run: (_c, args) => {
      writeFileSync(args[args.length - 1] ?? '', 'half-typed');
      return { status: 1 };
    } });
    expect(result).toMatchObject({ kind: 'failed' });
  });

  it('reports an editor that cannot start', () => {
    const result = editTextExternally('x', { env: { EDITOR: 'missing' }, run: () => ({ status: null, error: new Error('ENOENT') }) });
    expect(result).toEqual({ kind: 'failed', reason: '打不开编辑器 missing：ENOENT' });
  });
});
