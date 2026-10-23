import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXTENSION_UI_REQUESTS,
  listExtensionUiQuestionSessionIds,
  putExtensionUiRequest,
  removeExtensionUiRequestById,
  removeExtensionUiRequestForSession,
  selectExtensionUiRequest,
  type ExtensionUiRequestState,
} from './extension-ui-request-registry';

function question(sessionId: string, requestId: string): ExtensionUiRequestState {
  return { sessionId, requestId, kind: 'select', title: `ask ${requestId}` };
}

describe('extension-ui request registry', () => {
  it('only exposes the asking session question to that session', () => {
    const registry = putExtensionUiRequest(EMPTY_EXTENSION_UI_REQUESTS, question('sess-bg', 'req-1'));
    expect(selectExtensionUiRequest(registry, 'sess-active')).toBeNull();
    expect(selectExtensionUiRequest(registry, 'sess-bg')?.requestId).toBe('req-1');
    expect(selectExtensionUiRequest(registry, null)).toBeNull();
  });

  it('keeps questions from different sessions side by side', () => {
    let registry = putExtensionUiRequest(EMPTY_EXTENSION_UI_REQUESTS, question('sess-b', 'req-b'));
    registry = putExtensionUiRequest(registry, question('sess-a', 'req-a'));
    expect(listExtensionUiQuestionSessionIds(registry)).toEqual(['sess-a', 'sess-b']);
  });

  it('replaces an older question from the same session', () => {
    let registry = putExtensionUiRequest(EMPTY_EXTENSION_UI_REQUESTS, question('sess-a', 'page-1'));
    registry = putExtensionUiRequest(registry, question('sess-a', 'page-2'));
    expect(selectExtensionUiRequest(registry, 'sess-a')?.requestId).toBe('page-2');
  });

  it('ignores a stale request id so an old resolve cannot clear the next page', () => {
    let registry = putExtensionUiRequest(EMPTY_EXTENSION_UI_REQUESTS, question('sess-a', 'page-1'));
    registry = putExtensionUiRequest(registry, question('sess-a', 'page-2'));
    expect(removeExtensionUiRequestById(registry, 'page-1')).toBe(registry);
    expect(removeExtensionUiRequestById(registry, 'page-2')).toEqual({});
  });

  it('clears one session without touching the others', () => {
    let registry = putExtensionUiRequest(EMPTY_EXTENSION_UI_REQUESTS, question('sess-a', 'req-a'));
    registry = putExtensionUiRequest(registry, question('sess-b', 'req-b'));
    const next = removeExtensionUiRequestForSession(registry, 'sess-a');
    expect(listExtensionUiQuestionSessionIds(next)).toEqual(['sess-b']);
    expect(removeExtensionUiRequestForSession(next, 'sess-missing')).toBe(next);
  });
});
