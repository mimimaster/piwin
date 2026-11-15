export type WebviewInspectionStatus = { supported: boolean; enabled: boolean };

/** Query by default; only an explicit boolean changes the native inspection opt-in. */
export async function requestWebviewInspection(enabled?: boolean): Promise<WebviewInspectionStatus> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return { supported: false, enabled: false };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<unknown>('webview_inspection', {
    ...(enabled === undefined ? {} : { enabled }),
  });
  if (typeof result !== 'object' || result === null || !('supported' in result) ||
    !('enabled' in result) || typeof result.supported !== 'boolean' || typeof result.enabled !== 'boolean') {
    throw new Error('WebviewInspectionUnavailable: invalid native response');
  }
  return { supported: result.supported, enabled: result.enabled };
}
