import { describe, expect, it } from 'vitest';
import { resolveExplicitPlanExecutionMode } from './plan-execution-intent.js';

describe('resolveExplicitPlanExecutionMode', () => {
  it.each(['inline', 'in line', '请用 inline 执行', '我选择当前会话直接执行'])(
    'resolves inline: %s',
    (text) => {
      expect(resolveExplicitPlanExecutionMode(text)).toBe('inline');
    },
  );

  it('keeps the generated inline handoff explicit when its instruction mentions the current session twice', () => {
    expect(
      resolveExplicitPlanExecutionMode(
        '请读取计划，按照该计划在当前会话直接执行。不要再次询问执行方式；保持实施工作在当前会话完成。',
      ),
    ).toBe('inline');
  });

  it.each(['subagent', 'sub agent', '请用子代理执行', '选择委派方式'])(
    'resolves subagent: %s',
    (text) => {
      expect(resolveExplicitPlanExecutionMode(text)).toBe('subagent-driven');
    },
  );

  it.each([
    'inline 还是 subagent',
    '不要 inline',
    'not subagent',
    '讨论 inline 的优缺点',
    'inline execution 是什么意思？',
  ])('leaves non-selection text alone: %s', (text) => {
    expect(resolveExplicitPlanExecutionMode(text)).toBeUndefined();
  });
});
