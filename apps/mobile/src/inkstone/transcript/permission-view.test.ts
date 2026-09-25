import { describe, expect, it } from 'vitest';
import { describePermission } from './permission-view.js';

describe('describePermission', () => {
  it('drops Host detail that only repeats the command and keeps the rule as a fact', () => {
    const view = describePermission({
      type: 'permission/request',
      sessionId: 's1',
      requestId: 'p1',
      action: 'bash',
      detail: 'rm-recursive-force: rm -rf perm-test-3.txt && ls -la',
      defaultDecision: 'deny',
      context: {
        kind: 'command',
        summary: 'bash',
        command: 'rm -rf perm-test-3.txt && ls -la',
        reason: 'rm-recursive-force',
        destructive: true,
      },
    });
    expect(view).toMatchObject({
      kindLabel: '运行命令',
      tool: 'bash',
      target: 'rm -rf perm-test-3.txt && ls -la',
      detail: undefined,
      destructive: true,
      facts: ['规则 · rm-recursive-force'],
    });
  });

  it('keeps meaningful detail when there is no structured target', () => {
    const view = describePermission({
      type: 'permission/request',
      sessionId: 's1',
      requestId: 'p1',
      action: 'fetch',
      detail: '访问一个未列入白名单的域名',
      defaultDecision: 'deny',
    });
    expect(view.kindLabel).toBe('工具调用');
    expect(view.detail).toBe('访问一个未列入白名单的域名');
  });
});
