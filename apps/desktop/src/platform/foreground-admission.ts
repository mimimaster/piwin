import type { ChatUiState } from '../conversation/chat-reducer.js';

/** Send and live-run controls stay off while the selected session is unknown or reconciling. */
export function desktopForegroundMutationsEnabled(
  state: Pick<ChatUiState, 'activeSessionId' | 'foregroundAdmission' | 'nativeCliWriterBusy'>,
): boolean {
  if (state.nativeCliWriterBusy) {
    return false;
  }
  if (state.activeSessionId === null) {
    return true;
  }
  return state.foregroundAdmission === 'ready';
}
