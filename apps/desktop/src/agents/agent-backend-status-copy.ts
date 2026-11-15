type AgentBackendStatus = {
  state?: string | undefined;
  reason?: string | undefined;
  version?: string | undefined;
};

type AgentBackendStatusCopy = {
  badge: string;
  detail: string;
  actionLabel: string;
  reinstall: boolean;
};

/** Keep session-entry recovery guidance consistent with Agent settings. */
export function agentBackendStatusCopy(
  status: AgentBackendStatus | undefined,
  isChinese: boolean,
): AgentBackendStatusCopy {
  const reinstall = status?.state === 'unavailable'
    && status.reason?.split(':', 1)[0]?.trim() === 'agent-artifact-integrity';
  if (reinstall) {
    return {
      badge: isChinese ? '插件校验失败' : 'Plugin Check Failed',
      detail: isChinese
        ? '插件文件校验失败，文件可能缺失或与安装清单不一致。请到“扩展”重新安装该插件，再点击重新检测。'
        : 'Plugin file verification failed. Files may be missing or differ from the installation manifest. Reinstall the plugin in Extensions, then check again.',
      actionLabel: isChinese ? '查看修复方法' : 'View repair steps',
      reinstall: true,
    };
  }
  switch (status?.state) {
    case 'ready':
      return {
        badge: isChinese ? '已就绪' : 'Ready',
        detail: status.version
          ? `${isChinese ? '可用' : 'Ready'} · v${status.version}`
          : isChinese ? '可用' : 'Ready',
        actionLabel: isChinese ? '查看状态' : 'View status',
        reinstall: false,
      };
    case 'not-installed':
      return {
        badge: isChinese ? '未安装 CLI' : 'CLI Missing',
        detail: isChinese
          ? 'Host 上未找到该后端的 CLI。安装官方 CLI 后点重新检测。'
          : 'This backend’s CLI was not found on the Host. Install the official CLI, then check again.',
        actionLabel: isChinese ? '查看安装说明' : 'View install steps',
        reinstall: false,
      };
    case 'unauthenticated':
      return {
        badge: isChinese ? '未登录' : 'Sign-in Required',
        detail: isChinese
          ? `${status.version ? `已安装 v${status.version}，` : ''}需要在 Host 上登录该后端的 CLI，然后重新检测。`
          : `${status.version ? `Installed v${status.version}. ` : ''}Sign in to this backend’s CLI on the Host, then check again.`,
        actionLabel: isChinese ? '查看登录说明' : 'View sign-in steps',
        reinstall: false,
      };
    case 'unavailable':
      return {
        badge: isChinese ? '未就绪' : 'Not Ready',
        detail: status.reason || (isChinese ? '后端检测失败，请重新检测。' : 'Backend check failed. Check again.'),
        actionLabel: isChinese ? '查看问题' : 'View issue',
        reinstall: false,
      };
    default:
      return {
        badge: isChinese ? '待检测' : 'Check Pending',
        detail: isChinese ? '尚未检测，请点击重新检测。' : 'Not checked yet. Click Check again.',
        actionLabel: isChinese ? '查看状态' : 'View status',
        reinstall: false,
      };
  }
}
