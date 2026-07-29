import { describe, expect, it } from 'vitest';
import { resolveActivityIcon } from './run-activity-icon.js';
import type { RunActivityInput } from './run-activity-types.js';

const input = (kind: RunActivityInput['kind']): RunActivityInput => ({ kind, locale: 'en' });

describe('resolveActivityIcon', () => {
  it('maps waiting-first-token to Sparkles with generated img path', () => {
    const icon = resolveActivityIcon(input('waiting-first-token'));
    expect(icon.lucideName).toBe('Sparkles');
    expect(icon.imgSrc).toBe('/ui/run-state-waiting-first-token.png');
    expect(icon.kind).toBe('waiting-first-token');
  });

  it('maps connecting-model to the matching generated asset', () => {
    const icon = resolveActivityIcon(input('connecting-model'));
    expect(icon.imgSrc).toBe('/ui/run-state-connecting-model.png');
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
