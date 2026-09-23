import { describe, expect, it } from 'vitest';
import { artifactIncompleteCopy, hasLeakedToolCallMarkup } from './artifact-incomplete-copy.js';

describe('artifactIncompleteCopy', () => {
  it('names leaked DeepSeek DSML tool-call markup as the cause', () => {
    const source = '<li>返回「不支持的套餐平台」。Dev</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';
    expect(hasLeakedToolCallMarkup(source)).toBe(true);
    expect(artifactIncompleteCopy('zh-CN', source)).toContain('无法解析的工具调用标记');
    expect(artifactIncompleteCopy('en', source)).toContain('tool-call markup');
  });

  it('detects ASCII special-token delimiters', () => {
    expect(hasLeakedToolCallMarkup('<div>x</div><|tool_call|>')).toBe(true);
  });

  it('keeps the short caveat for a plain truncated fence', () => {
    const source = '<main>Visible portion</main><script>const broken = [a || b];';
    expect(hasLeakedToolCallMarkup(source)).toBe(false);
    expect(artifactIncompleteCopy('zh-CN', source)).toBe('输出未完成，预览可能不全');
  });
});
