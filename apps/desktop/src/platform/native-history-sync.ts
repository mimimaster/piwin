/**
 * Opening an external-agent session whose history still lives only in the
 * agent (imported from its catalog, or continued in its own TUI). The Host
 * marks such a resume `nativeHistory: 'unsynced'`; Desktop paints what the
 * transcript has, replays in the background, then reloads on success.
 */
import { formatError, type HostCommand, type HostResponse } from '@piwin/contracts';
import type { DesktopLocale } from '../i18n/desktop-locale.js';

export type NativeHistorySync = { ok: true } | { ok: false; error: string };

type NativeHistoryHost = { request: (command: HostCommand) => Promise<HostResponse> };

/** Ask the Host to replay the agent's history into the transcript. Never rejects. */
export async function syncNativeHistory(host: NativeHistoryHost, sessionId: string): Promise<NativeHistorySync> {
  try {
    const synced = await host.request({ type: 'agents/cli-snapshot', sessionId });
    return synced.success ? { ok: true } : { ok: false, error: synced.error };
  } catch (error) {
    // A replay that outlives the request timeout rejects; the caller must still settle.
    return { ok: false, error: formatError(error) };
  }
}

export function nativeHistorySyncFailure(locale: DesktopLocale, error: string): string {
  return locale === 'zh-CN'
    ? `未能同步该会话在外部 Agent 中的历史：${error}`
    : `Could not sync this conversation's history from its agent: ${error}`;
}
