import type { HostProblem, HostResponse } from '@piwin/contracts';
import { getDesktopCopy, getDesktopTranslator, type DesktopLocale } from '../i18n/desktop-locale';
import { foregroundMismatchNotice, readForegroundProblem } from '../composer/prompt-foreground';
import { isWorkbenchHostTeardownError } from '../workbench/workbench-host-teardown';

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
    case 'summary-model-unavailable':
      return summaryModelUnavailableNotice(problem.data, locale);
    case 'session-handoff-refused':
      return sessionHandoffRefusedNotice(problem.data, locale);
    case 'session-handoff-summary-missing':
      return locale === 'zh-CN'
        ? '这份交接摘要已经不在了。'
        : 'This handoff summary is no longer on disk.';
    default:
      return undefined;
  }
}

/** `cancelled` maps to '' — the user asked for it, so there is nothing to report. */
function sessionHandoffRefusedNotice(data: unknown, locale: DesktopLocale): string | undefined {
  const reason =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>).reason : undefined;
  const zh = locale === 'zh-CN';
  switch (reason) {
    case 'cancelled':
      return '';
    case 'empty-transcript':
      return zh ? '这个会话还没有对话，没有可交接的内容。' : 'This session has no conversation to hand off yet.';
    case 'already-running':
      return zh
        ? '这个会话正在生成摘要（交接或导出），等它结束再试。'
        : 'A summary is already being written for this session. Try again when it finishes.';
    case 'archived':
      return zh ? '已归档的会话不能交接，先恢复它。' : 'Restore this archived session before handing it off.';
    case 'empty-summary':
      return zh
        ? '模型返回了空摘要，没有创建新会话。可以重试或换个模型。'
        : 'The model returned an empty summary, so no session was created. Retry or switch models.';
    default:
      return undefined;
  }
}

/** Name the model that could not write the summary and point at the fix. */
function summaryModelUnavailableNotice(data: unknown, locale: DesktopLocale): string {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const model = record.model as { providerId?: unknown; modelId?: unknown } | undefined;
  const label =
    typeof model?.providerId === 'string' && typeof model.modelId === 'string'
      ? `${model.providerId}/${model.modelId}`
      : undefined;
  const reason = typeof record.reason === 'string' ? record.reason : '';
  if (locale === 'zh-CN') {
    return label
      ? `摘要模型 ${label} 当前不可用：${reason}。请切换源会话的模型后重试。`
      : `摘要生成失败（源会话未指定模型，使用了运行时默认模型）：${reason}。请为源会话选择可用模型后重试。`;
  }
  return label
    ? `Summary model ${label} is unavailable: ${reason}. Switch the source session's model and try again.`
    : `The summary failed on the runtime's default model: ${reason}. Pick a model for the source session and try again.`;
}
