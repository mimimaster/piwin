import { describe, expect, it } from 'vitest';
import type { DiscoveredModel } from '@piwin/contracts';
import { filterDiscoveredModels } from './DiscoverModelsDialog.js';

const models: DiscoveredModel[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'claude-fable-5', label: 'Claude Fable 5' },
  { id: 'grok-3-mini' },
  { id: 'grok-4.20-reasoning' },
  { id: 'qwen/qwen3-8b', label: 'Qwen3 8B' },
];

describe('filterDiscoveredModels', () => {
  it('returns all models when query is empty', () => {
    expect(filterDiscoveredModels(models, '')).toEqual(models);
    expect(filterDiscoveredModels(models, '   ')).toEqual(models);
  });

  it('filters by id substring', () => {
    const result = filterDiscoveredModels(models, 'grok');
    expect(result.map((model) => model.id)).toEqual(['grok-3-mini', 'grok-4.20-reasoning']);
  });

  it('filters by label substring', () => {
    const result = filterDiscoveredModels(models, 'luna');
    expect(result.map((model) => model.id)).toEqual(['gpt-5.6-luna']);
  });

  it('ranks id prefix matches first', () => {
    const result = filterDiscoveredModels(models, 'gpt');
    expect(result.map((model) => model.id)).toEqual(['gpt-5.5', 'gpt-5.6-luna']);
  });

  it('supports multi-token AND matching', () => {
    const result = filterDiscoveredModels(models, 'gpt 5.6');
    expect(result.map((model) => model.id)).toEqual(['gpt-5.6-luna']);
  });

  it('is case-insensitive', () => {
    const result = filterDiscoveredModels(models, 'CLAUDE');
    expect(result.map((model) => model.id)).toEqual(['claude-fable-5']);
  });

  it('matches path-style ids by prefix', () => {
    const result = filterDiscoveredModels(models, 'qwen/');
    expect(result.map((model) => model.id)).toEqual(['qwen/qwen3-8b']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterDiscoveredModels(models, 'does-not-exist')).toEqual([]);
  });
});
