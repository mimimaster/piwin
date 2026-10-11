import { describe, expect, it } from 'vitest';
import { describeToolError } from './tool-error-view.js';

describe('describeToolError', () => {
  it('hides the policy code of a refused permission', () => {
    const text = describeToolError({
      category: 'permission',
      message: 'Permission denied for bash: chain-ask:ask-all-no-match',
    });
    expect(text).toBe('没有获得许可，没有执行');
  });

  it('says when the refusal was about a path outside the project', () => {
    const text = describeToolError({
      category: 'permission',
      message: "Permission denied for file_write: writing to /etc/x outside this session's workspace was not approved (path-escapes-project-root)",
    });
    expect(text).toContain('项目目录之外');
  });

  it('keeps the Host message for failures that name their cause', () => {
    expect(describeToolError({ category: 'execution', message: 'ENOENT: no such file' })).toBe('ENOENT: no such file');
  });

  it('reports a cancelled call as cancelled', () => {
    expect(describeToolError({ category: 'cancelled', message: 'aborted' })).toBe('已取消');
  });
});
