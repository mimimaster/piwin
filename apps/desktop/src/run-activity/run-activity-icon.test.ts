import { describe, expect, it } from 'vitest';
import { resolveActivityIcon } from './run-activity-icon.js';
import type { RunActivityInput } from './run-activity-types.js';

const input = (kind: RunActivityInput['kind']): RunActivityInput => ({ kind, locale: 'en' });

describe('resolveActivityIcon', () => {
  it('maps waiting-first-token to Sparkles and thinking actionCategory', () => {
    const icon = resolveActivityIcon(input('waiting-first-token'));
    expect(icon).toEqual({ kind: 'waiting-first-token', actionCategory: 'thinking', lucideName: 'Sparkles' });
  });

  it('maps connecting-model to Wifi', () => {
    expect(resolveActivityIcon(input('connecting-model')).lucideName).toBe('Wifi');
  });

  it('maps working with run_command to terminal category', () => {
    const icon = resolveActivityIcon({ kind: 'working', activeToolName: 'run_command', locale: 'en' });
    expect(icon.lucideName).toBe('Terminal');
    expect(icon.actionCategory).toBe('terminal');
  });

  it('maps working with write_to_file to edit category', () => {
    const icon = resolveActivityIcon({ kind: 'working', activeToolName: 'write_to_file', locale: 'en' });
    expect(icon.lucideName).toBe('FileCode');
    expect(icon.actionCategory).toBe('edit');
  });

  it('maps working with grep_search to search category', () => {
    const icon = resolveActivityIcon({ kind: 'working', activeToolName: 'grep_search', locale: 'en' });
    expect(icon.lucideName).toBe('Search');
    expect(icon.actionCategory).toBe('search');
  });

  it('maps working-without-tool to Code', () => {
    const icon = resolveActivityIcon(input('working'));
    expect(icon.lucideName).toBe('Code');
  });
});
