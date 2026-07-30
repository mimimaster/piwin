import { describe, expect, it } from 'vitest';
import { resolveActivityIcon } from './run-activity-icon.js';
import type { RunActivityInput } from './run-activity-types.js';

const input = (kind: RunActivityInput['kind']): RunActivityInput => ({ kind, locale: 'en' });

describe('resolveActivityIcon', () => {
  it('maps waiting-first-token to Sparkles', () => {
    const icon = resolveActivityIcon(input('waiting-first-token'));
    expect(icon).toEqual({ kind: 'waiting-first-token', lucideName: 'Sparkles' });
  });

  it('maps connecting-model to Wifi', () => {
    expect(resolveActivityIcon(input('connecting-model')).lucideName).toBe('Wifi');
  });

  it('maps working-with-tool to Terminal', () => {
    const icon = resolveActivityIcon({ kind: 'working', activeToolName: 'bash', locale: 'en' });
    expect(icon.lucideName).toBe('Terminal');
  });

  it('maps working-without-tool to Code', () => {
    const icon = resolveActivityIcon(input('working'));
    expect(icon.lucideName).toBe('Code');
  });
});
