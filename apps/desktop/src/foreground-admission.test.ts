import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
import { desktopForegroundMutationsEnabled } from './foreground-admission.js';

describe('desktopForegroundMutationsEnabled', () => {
  it('allows Send while no session is selected', () => {
    const state = createInitialChatUiState();
    expect(state.foregroundAdmission).toBe('unknown');
    expect(desktopForegroundMutationsEnabled(state)).toBe(true);
  });

  it('disables Send and run controls while reconciling a selected session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    expect(state.foregroundAdmission).toBe('reconciling');
    expect(desktopForegroundMutationsEnabled(state)).toBe(false);
    state = chatUiReducer(state, { type: 'foreground/admission', admission: 'ready' });
    expect(desktopForegroundMutationsEnabled(state)).toBe(true);
  });

  it('disables Send and run controls while a selected session is unknown because Host is not ready', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'foreground/admission', admission: 'ready' });
    state = chatUiReducer(state, { type: 'host/status', ready: false, mock: false });
    expect(state.foregroundAdmission).toBe('unknown');
    expect(desktopForegroundMutationsEnabled(state)).toBe(false);
  });

  it('disables Send while native CLI still owns the writer, including drafts', () => {
    let state = createInitialChatUiState();
    expect(desktopForegroundMutationsEnabled(state)).toBe(true);
    state = chatUiReducer(state, { type: 'native-cli/writer-busy', busy: true });
    expect(state.nativeCliWriterBusy).toBe(true);
    expect(desktopForegroundMutationsEnabled(state)).toBe(false);
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'foreground/admission', admission: 'ready' });
    expect(desktopForegroundMutationsEnabled(state)).toBe(false);
    state = chatUiReducer(state, { type: 'native-cli/writer-busy', busy: false });
    expect(desktopForegroundMutationsEnabled(state)).toBe(true);
  });
});
