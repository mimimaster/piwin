import { describe, expect, it } from 'vitest';
import { describePermissionPrompt } from './permission-prompt-view.js';

const ROOTS = ['/work/proj'];

describe('describePermissionPrompt', () => {
  it('shows the command, not the policy reason, and names the kind in Chinese', () => {
    const view = describePermissionPrompt(
      {
        action: 'bash',
        detail: 'ask-all-no-match: python3 fizz.py',
        context: { kind: 'command', summary: 'Run command', command: 'python3 fizz.py', cwd: '/work/proj' },
      },
      ROOTS,
    );
    expect(view.title).toBe('需要确认：运行命令');
    expect(view.message).toContain('python3 fizz.py');
    expect(view.message).toContain('目录：.');
    expect(view.message).not.toContain('ask-all-no-match');
  });

  it('lists the files of a write relative to the project', () => {
    const view = describePermissionPrompt(
      {
        action: 'file-write',
        detail: '/work/proj/src/a.ts',
        context: {
          kind: 'file-write',
          summary: 'Write file',
          command: '/work/proj/src/a.ts',
          paths: ['/work/proj/src/a.ts'],
        },
      },
      ROOTS,
    );
    expect(view.title).toBe('需要确认：写文件');
    expect(view.message).toBe('文件：src/a.ts');
  });

  it('flags destructive, outside-workspace and secret-related actions', () => {
    const view = describePermissionPrompt(
      {
        action: 'bash',
        detail: 'x',
        context: {
          kind: 'command',
          summary: 's',
          command: 'rm -rf ~/x',
          destructive: true,
          outsideWorkspace: true,
          secretRelated: true,
        },
      },
      ROOTS,
    );
    expect(view.message).toContain('⚠ 破坏性操作');
    expect(view.message).toContain('⚠ 在项目目录之外');
    expect(view.message).toContain('⚠ 可能涉及密钥');
  });

  it('carries an external agent’s own choices and says who remembers the answer', () => {
    const backendOptions = [
      { optionId: 'a', label: 'Allow once', kind: 'allow_once' as const },
      { optionId: 'r', label: 'Reject', kind: 'reject_once' as const },
    ];
    const view = describePermissionPrompt(
      {
        action: 'bash',
        detail: 'x',
        context: { kind: 'command', summary: 's', command: 'ls', backendOptions, backendAgentId: 'grok' },
      },
      ROOTS,
    );
    expect(view.backendOptions).toEqual(backendOptions);
    expect(view.message).toContain('由 grok 决定并记住');
  });

  it('falls back to the Host text when there is no structured context', () => {
    expect(describePermissionPrompt({ action: 'custom', detail: 'do it' }, ROOTS)).toEqual({
      title: '需要确认：custom',
      message: 'do it',
    });
  });
});
