import { describe, expect, it } from 'vitest';
import { pluginSourceKindLabel } from './plugin.js';

describe('pluginSourceKindLabel', () => {
  it('labels bundled as 应用内置 / bundled', () => {
    expect(pluginSourceKindLabel('bundled', 'zh-CN')).toBe('应用内置');
    expect(pluginSourceKindLabel('bundled', 'en')).toBe('bundled');
  });

  it('keeps Git and translates local / registry in Chinese', () => {
    expect(pluginSourceKindLabel('git', 'zh-CN')).toBe('Git');
    expect(pluginSourceKindLabel('local', 'zh-CN')).toBe('本地');
    expect(pluginSourceKindLabel('registry', 'zh-CN')).toBe('商店');
  });
});
