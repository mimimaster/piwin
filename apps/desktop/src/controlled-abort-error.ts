/**
 * Host-controlled pause/stop often surfaces as a provider AbortError string.
 * Those must not become a failed toast or keep the sidebar spinner alive —
 * `run/terminal` owns the user-visible paused/stopped outcome.
 */
export function looksLikeControlledAbortErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'aborted' ||
    normalized.includes('operation was aborted') ||
    normalized.includes('request was aborted') ||
    normalized.includes('the run was cancelled') ||
    normalized.includes('this run was cancelled') ||
    normalized.includes('stream aborted') ||
    normalized.includes('aborterror')
  );
}
