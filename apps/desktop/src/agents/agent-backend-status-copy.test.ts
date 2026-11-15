import { describe, expect, it } from 'vitest';
import { agentBackendStatusCopy } from './agent-backend-status-copy.js';

describe('agent backend status copy', () => {
  it.each([true, false])('explains integrity failures with reinstall guidance (Chinese: %s)', (isChinese) => {
    const copy = agentBackendStatusCopy({
      state: 'unavailable',
      reason: 'agent-artifact-integrity: file does not match its declaration',
    }, isChinese);
    expect(copy.reinstall).toBe(true);
    expect(copy.badge).toBe(isChinese ? '插件校验失败' : 'Plugin Check Failed');
    expect(copy.detail).toContain(isChinese ? '重新安装' : 'Reinstall');
    expect(copy.detail).not.toContain('agent-artifact-integrity');
  });

  it.each([
    { status: undefined, badge: '待检测', action: '查看状态' },
    { status: { state: 'not-installed' }, badge: '未安装 CLI', action: '查看安装说明' },
    { status: { state: 'unauthenticated' }, badge: '未登录', action: '查看登录说明' },
    { status: { state: 'unavailable', reason: 'handshake timed out' }, badge: '未就绪', action: '查看问题' },
    { status: { state: 'ready', version: '1.5.5' }, badge: '已就绪', action: '查看状态' },
  ])('distinguishes $badge without prescribing a reinstall', ({ status, badge, action }) => {
    const copy = agentBackendStatusCopy(status, true);
    expect(copy.badge).toBe(badge);
    expect(copy.actionLabel).toBe(action);
    expect(copy.reinstall).toBe(false);
  });

  it('does not turn a mention of integrity in a different failure into a checksum failure', () => {
    const copy = agentBackendStatusCopy({ state: 'unavailable', reason: 'other-error: agent-artifact-integrity' }, true);
    expect(copy.reinstall).toBe(false);
  });

  it('retains the detected CLI version when ready', () => {
    expect(agentBackendStatusCopy({ state: 'ready', version: '1.5.5' }, true).detail).toBe('可用 · v1.5.5');
  });

  it('retains the installed CLI version when sign-in is required', () => {
    expect(agentBackendStatusCopy({ state: 'unauthenticated', version: '1.5.5' }, true).detail).toContain('已安装 v1.5.5');
  });
});
