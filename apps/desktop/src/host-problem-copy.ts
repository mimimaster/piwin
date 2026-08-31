import type { HostProblem, HostResponse } from '@piwin/contracts';
import { getDesktopCopy, getDesktopTranslator, type DesktopLocale } from './desktop-locale';
import { foregroundMismatchNotice, readForegroundProblem } from './prompt-foreground';
import { isWorkbenchHostTeardownError } from './workbench-host-teardown';

export function hostReconnectNotice(locale: DesktopLocale): string {
  return getDesktopCopy(locale).composer.hostConnecting;
}

export function isSettingsRevisionConflict(response: HostResponse): boolean {
  return response.success === false && response.problem?.code === 'settings-revision-conflict';
}

/** Map a Host problem to Desktop copy. Callers still branch on `problem.code`. */
export function hostFailureNotice(response: HostResponse, locale: DesktopLocale): string {
  if (response.success) {
    return '';
  }
  const mapped = hostProblemNotice(response.problem, locale);
  if (mapped !== undefined) {
    return mapped;
  }
  const mismatch = readForegroundProblem(response);
  if (mismatch) {
    return foregroundMismatchNotice(mismatch, locale);
  }
  if (isWorkbenchHostTeardownError(response.error)) {
    return hostReconnectNotice(locale);
  }
  if (response.error.startsWith('paused-run:')) {
    return locale === 'zh-CN'
      ? '上一轮已暂停。点继续接着做，或再发一条新消息结束暂停。'
      : 'The previous turn is paused. Continue it, or send a new message to start a new turn.';
  }
  if (response.error.includes('intervention-command-unsupported')) {
    return locale === 'zh-CN'
      ? '斜杠命令不能插入当前回合。等这轮结束再发 /compact。'
      : 'Slash commands cannot steer the current run. Wait for it to finish, then send /compact.';
  }
  if (response.error.startsWith('Host request timed out:')) {
    return locale === 'zh-CN'
      ? 'Host 还没确认这条操作。会话还在，再发一次；不要当成断线。'
      : 'The Host did not acknowledge that action in time. The session is still there — send again.';
  }
  return remoteAdmissionNotice(response.error, locale) ?? response.error;
}

function remoteAdmissionNotice(error: string, locale: DesktopLocale): string | undefined {
  if (error === 'Remote Host does not accept these settings domains yet') {
    return locale === 'zh-CN'
      ? '当前 Host 还不支持这些设置项。更新 Host 后再保存。'
      : 'This Host does not accept these settings domains yet. Update the Host and save again.';
  }
  if (error.startsWith('Remote command is not enabled yet:')) {
    return locale === 'zh-CN'
      ? '当前 Host 还没开放这条远程命令'
      : 'This Host does not enable that remote command yet';
  }
  if (error.includes('does not expose') && error.includes('to remote clients')) {
    return locale === 'zh-CN'
      ? '当前 Host 还没对远程壳开放这条操作（不是系统权限）。重启壳子再连一次。'
      : 'This Host has not opened that remote command yet. Reconnect the shell.';
  }
  if (error.startsWith('Remote command payload was rejected:')) {
    if (error.includes('settings/apply')) {
      // Old Hosts refuse desktop restore. The click already applied in this
      // window; do not stack toasts the operator cannot act on.
      return '';
    }
    return locale === 'zh-CN'
      ? '这条消息里的路径引用远程 Host 不能用。选区会作为正文发送。'
      : 'The remote Host rejected a file-path reference in this prompt.';
  }
  return undefined;
}

export function hostProblemNotice(
  problem: HostProblem | undefined,
  locale: DesktopLocale,
): string | undefined {
  const copy = getDesktopCopy(locale);
  const translator = getDesktopTranslator(locale);
  switch (problem?.code) {
    case 'session-busy':
      return copy.composer.sessionBodyBusy;
    case 'ticket-consumed':
      return copy.composer.permissionAlreadyResolved;
    case 'settings-revision-conflict':
      return translator.settings.domainConflict;
    case 'notes-revision-conflict':
      return translator.settings.notesConflict;
    case 'todo-revision-conflict':
      return translator.settings.todoConflict;
    case 'idempotency-conflict':
      return copy.composer.requestDuplicateKey;
    default:
      return undefined;
  }
}
