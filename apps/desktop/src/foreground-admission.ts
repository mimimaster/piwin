import type { ChatUiState } from './chat-reducer.js';

/** Send and live-run controls stay off while the selected session is unknown or reconciling. */
export function desktopForegroundMutationsEnabled(
  state: Pick<ChatUiState, 'activeSessionId' | 'foregroundAdmission'>,
): boolean {
  if (state.activeSessionId === null) {
    return true;
  }
  return state.foregroundAdmission === 'ready';
}
