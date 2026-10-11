/**
 * Desktop prompt admission: normal Send is if-idle; only a confirmed
 * “中断并发送” uses replace-run. The protocol logic is shared with every
 * shell in @piwin/host-client; this file adds Desktop's capability gates and
 * localized notices.
 */
import type { ForegroundRunMismatchProblem, RemoteCapabilitySummary } from '@piwin/contracts';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

export {
  canConfirmReplaceRun,
  isBusyForegroundProblem,
  nextPromptForeground,
  readForegroundProblem,
  requestPromptWithForeground,
  type BusyRunChoice,
  type SessionPromptCommand,
} from '@piwin/host-client';

/** True only when a remote Host advertised prompt admission. Local sidecar is always allowed. */
export function hostSupportsForegroundAdmission(
  capabilities: RemoteCapabilitySummary | undefined,
): boolean {
  return capabilities?.foregroundRunAdmission === true;
}

export function canSendForegroundPrompt(input: {
  transport: 'mock' | 'live' | 'remote';
  capabilities?: RemoteCapabilitySummary;
}): boolean {
  return input.transport !== 'remote' || hostSupportsForegroundAdmission(input.capabilities);
}

export function foregroundMismatchNotice(
  problem: ForegroundRunMismatchProblem,
  locale: DesktopLocale,
): string {
  const copy = getDesktopCopy(locale).composer;
  switch (problem.data.reason) {
    case 'already-finished':
      return copy.foregroundMismatchFinished;
    case 'changed':
      return copy.foregroundMismatchChanged;
    case 'active':
      return copy.busyOtherClient;
    case 'transitioning':
      return copy.foregroundReplaceDescription;
  }
}

export function supersededByNewPromptNotice(locale: DesktopLocale): string {
  return getDesktopCopy(locale).composer.supersededByNewPrompt;
}
