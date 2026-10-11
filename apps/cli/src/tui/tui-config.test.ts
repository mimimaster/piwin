import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS } from './keybindings.js';
import { DEFAULT_STATUS_TEMPLATE } from './status-template.js';
import { loadTuiConfig } from './tui-config.js';

const roots: string[] = [];
function root(files: Record<string, string> = {}): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'piwin-tui-config-'));
  roots.push(directory);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(directory, name), content);
  return directory;
}
afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('loadTuiConfig', () => {
  it('uses defaults when no file exists', () => {
    expect(loadTuiConfig(root())).toEqual({
      keybindings: DEFAULT_KEYBINDINGS,
      statusTemplate: DEFAULT_STATUS_TEMPLATE,
      problems: [],
    });
  });

  it('reads both files', () => {
    const config = loadTuiConfig(
      root({ 'keybindings.json': '{"sessions":"alt+s"}', 'tui.json': '{"statusLine":"{model} · {context}"}' }),
    );
    expect(config.keybindings.sessions).toBe('alt+s');
    expect(config.statusTemplate).toBe('{model} · {context}');
    expect(config.problems).toEqual([]);
  });

  it('reports invalid JSON and falls back', () => {
    const config = loadTuiConfig(root({ 'keybindings.json': '{oops', 'tui.json': 'nope' }));
    expect(config.keybindings).toEqual(DEFAULT_KEYBINDINGS);
    expect(config.problems).toHaveLength(2);
    expect(config.problems[0]).toContain('keybindings.json');
  });

  it('reports a misspelled status field and keeps the default line', () => {
    const config = loadTuiConfig(root({ 'tui.json': '{"statusLine":"{modle}"}' }));
    expect(config.statusTemplate).toBe(DEFAULT_STATUS_TEMPLATE);
    expect(config.problems).toEqual(['tui.json 的 statusLine 里没有 {modle}，已使用默认状态栏']);
  });

  it('reports a key that cannot be bound while keeping the others', () => {
    const config = loadTuiConfig(root({ 'keybindings.json': '{"sessions":"ctrl+c","history":"alt+h"}' }));
    expect(config.keybindings.sessions).toBe('ctrl+s');
    expect(config.keybindings.history).toBe('alt+h');
    expect(config.problems).toHaveLength(1);
  });
});
