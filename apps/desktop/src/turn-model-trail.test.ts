import { describe, expect, it } from 'vitest';
import { formatTurnModelTrail, resolveTurnModelTrail } from './turn-model-trail';

const luna = { providerId: 'openai-codex', modelId: 'gpt-6-luna' };
const deepseek = { providerId: 'custom-anthropic-2', modelId: 'deepseek/deepseek-v4.1-flash' };
const label = (modelId: string): string => modelId.split('/').pop() ?? modelId;

describe('resolveTurnModelTrail', () => {
  it('names the model a turn switched to, not the one it started on', () => {
    const trail = resolveTurnModelTrail([
      { role: 'user' },
      { role: 'assistant', model: luna },
      { role: 'assistant', model: luna },
      { role: 'assistant', model: deepseek },
      { role: 'assistant', model: deepseek },
    ]);
    expect(trail.latest).toEqual(deepseek);
    expect(trail.models).toEqual([luna, deepseek]);
    expect(formatTurnModelTrail(trail, label)).toBe('gpt-6-luna → deepseek-v4.1-flash');
  });

  it('keeps the ends of a turn that switched more than once', () => {
    const trail = resolveTurnModelTrail([
      { role: 'assistant', model: luna },
      { role: 'assistant', model: deepseek },
      { role: 'assistant', model: luna },
    ]);
    expect(formatTurnModelTrail(trail, label)).toBe('gpt-6-luna → … → gpt-6-luna');
  });

  it('shows a single model plainly and ignores user rows', () => {
    const trail = resolveTurnModelTrail([
      { role: 'user', model: deepseek },
      { role: 'assistant', model: luna },
    ]);
    expect(formatTurnModelTrail(trail, label)).toBe('gpt-6-luna');
    expect(resolveTurnModelTrail([{ role: 'user' }]).latest).toBeNull();
  });
});
