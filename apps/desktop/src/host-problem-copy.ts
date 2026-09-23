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
  if (isStaleQueuedTurnError(response.error)) {
    return locale === 'zh-CN'
      ? '这条排队消息已经开始执行或已被移除，列表已刷新。'
      : 'This queued message already started or was removed. The queue has been refreshed.';
  }
  if (isStaleInterventionError(response.error)) {
    return locale === 'zh-CN'
      ? '这条调整已经生效或已结束，不能再修改。'
      : 'This adjustment was already applied or has ended, so it can no longer be changed.';
  }
  if (response.error.includes('intervention-command-unsupported')) {
    return locale === 'zh-CN'
      ? '当前对话轮次正在执行中，无法插入斜杠命令。请等待本轮结束再发送 /compact。'
      : 'Slash commands cannot steer the current run. Wait for it to finish, then send /compact.';
  }
  if (response.error.startsWith('Host request timed out:')) {
    return locale === 'zh-CN'
      ? 'Host 还没确认这条操作。会话还在，再发一次；不要当成断线。'
      : 'The Host did not acknowledge that action in time. The session is still there — send again.';
  }
  if (isPiwinRootLeaseError(response.error)) {
    return piwinRootLeaseNotice(locale);
  }
  return remoteAdmissionNotice(response.error, locale) ?? response.error;
}

/**
 * Edit/cancel reached Host after the intervention left `pending`. Host
 * re-pushes the durable record with the failure, so the card corrects itself.
 */
export function isStaleInterventionError(error: string): boolean {
  return error === 'intervention-revision-conflict' || error === 'intervention-not-found';
}

/**
 * A queue action targeted a row Host already moved on (started, converted,
 * cancelled, edited elsewhere). Callers refresh the queue from Host.
 */
export function isStaleQueuedTurnError(error: string): boolean {
  return (
    error === 'queued-turn-revision-conflict' ||
    error === 'queued-turn-not-found' ||
    error === 'queued-turn-not-pending'
  );
}

function isPiwinRootLeaseError(error: string): boolean {
  return (
    error.includes('piwin root ownership') ||
    error.includes('piwin root owner') ||
    error.includes('piwin root lease') ||
    error.includes('data directory lock')
  );
}

function piwinRootLeaseNotice(locale: DesktopLocale): string {
  return locale === 'zh-CN'
    ? 'Host 数据目录已失效，请重启 Host。'
    : 'This Host lost its data directory lock. Restart the Host.';
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
      ? '当前 Host 尚未对远程客户端开放此操作（不是系统权限问题）。请重新连接客户端后再试。'
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
    case 'piwin-root-lease-compromised':
      return piwinRootLeaseNotice(locale);
    default:
      return undefined;
  }
}
