import { describe, expect, it } from 'vitest';
import { hostFailureNotice, hostProblemNotice } from './host-problem-copy';

describe('host problem copy', () => {
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
