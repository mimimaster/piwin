import { describe, expect, it } from 'vitest';
import { hostFailureNotice, hostProblemNotice, isSettingsRevisionConflict } from './host-problem-copy';

describe('host problem copy', () => {
  it('detects a typed settings revision conflict', () => {
    expect(
      isSettingsRevisionConflict({
        type: 'response',
        command: 'settings/apply',
        success: false,
        error: 'settings-revision-conflict',
        problem: { code: 'settings-revision-conflict' },
      }),
    ).toBe(true);
    expect(
      isSettingsRevisionConflict({
        type: 'response',
        command: 'settings/apply',
        success: false,
        error: 'settings-revision-conflict',
      }),
    ).toBe(false);
    expect(
      isSettingsRevisionConflict({
        type: 'response',
        command: 'settings/apply',
        success: true,
      }),
    ).toBe(false);
  });

  it('maps stable problem codes to locale strings', () => {
    expect(hostProblemNotice({ code: 'session-busy' }, 'en')).toMatch(/compacting or deleting/i);
    expect(hostProblemNotice({ code: 'notes-revision-conflict' }, 'zh-CN')).toMatch(/笔记/);
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'session-busy: body-job',
          problem: { code: 'session-busy' },
        },
        'en',
      ),
    ).toMatch(/compacting or deleting/i);
  });

  it('maps remote admission denials off the protocol string', () => {
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'Remote command is not enabled yet: session/prompt',
        },
        'zh-CN',
      ),
    ).toMatch(/还没开放/);
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'Remote command payload was rejected: session/prompt',
        },
        'zh-CN',
      ),
    ).toMatch(/路径引用/);
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'settings/apply',
          success: false,
          error: 'Remote command payload was rejected: settings/apply',
        },
        'zh-CN',
      ),
    ).toBe('');
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'models/discover',
          success: false,
          error: 'This Host does not expose models/discover to remote clients',
        },
        'zh-CN',
      ),
    ).toMatch(/不是系统权限/);
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'settings/apply',
          success: false,
          error: 'Remote Host does not accept these settings domains yet',
        },
        'zh-CN',
      ),
    ).toMatch(/还不支持这些设置项/);
  });

  it('maps a leftover paused-run protocol string off the checkpoint UUID', () => {
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error:
            'paused-run: session session-mth19yeb-jup3xc4a has resumable checkpoint 6448b534-4fc4-43b9-ac84-7e487d4972ab',
        },
        'zh-CN',
      ),
    ).toMatch(/上一轮已暂停/);
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'paused-run: session s1 has resumable checkpoint ckpt-1',
        },
        'en',
      ),
    ).toMatch(/paused/i);
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'paused-run: session s1 has resumable checkpoint ckpt-1',
        },
        'zh-CN',
      ),
    ).not.toMatch(/checkpoint/);
  });

  it('maps slash-command interventions off the protocol string', () => {
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'run/intervention-submit',
          success: false,
          error: 'intervention-command-unsupported: slash commands must be sent as a normal turn',
        },
        'zh-CN',
      ),
    ).toMatch(/斜杠命令不能插入当前回合/);
  });

  it('maps a dropped Host socket to reconnecting copy', () => {
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'Host transport is not open',
        },
        'zh-CN',
      ),
    ).toMatch(/正在连接/);
  });

  it('does not treat a prompt ack timeout as a dropped socket', () => {
    expect(
      hostFailureNotice(
        {
          type: 'response',
          command: 'session/prompt',
          success: false,
          error: 'Host request timed out: session/prompt',
        },
        'zh-CN',
      ),
    ).toMatch(/还没确认/);
  });
});
