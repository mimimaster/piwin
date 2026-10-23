// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionUiRequestState } from '../extensions/extension-ui-request-registry';
import {
  useExtensionUiRequests,
  type ExtensionUiRequestsController,
} from './use-extension-ui-requests';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** Minimal renderHook: re-renders the hook with a new active session on demand. */
function renderRequests(initialSessionId: string) {
  const latest: { current: ExtensionUiRequestsController | null } = { current: null };
  function Probe({ sessionId }: { sessionId: string }): null {
    latest.current = useExtensionUiRequests(sessionId);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  const rerender = (sessionId: string): void => act(() => root.render(<Probe sessionId={sessionId} />));
  rerender(initialSessionId);
  return {
    get current(): ExtensionUiRequestsController {
      if (!latest.current) throw new Error('hook not rendered');
      return latest.current;
    },
    rerender,
  };
}

function question(sessionId: string, requestId: string): ExtensionUiRequestState {
  return { sessionId, requestId, kind: 'input', title: `ask ${requestId}` };
}

describe('useExtensionUiRequests', () => {
  it('does not surface a background session question in the active session', () => {
    const result = renderRequests('sess-active');
    act(() => result.current.showExtensionUiRequest(question('sess-bg', 'req-bg')));
    expect(result.current.extensionUiRequest).toBeNull();
    expect(result.current.extensionUiQuestionSessionIds).toEqual(['sess-bg']);
  });

  it('shows the question once the user switches to the asking session', () => {
    const result = renderRequests('sess-active');
    act(() => result.current.showExtensionUiRequest(question('sess-bg', 'req-bg')));
    result.rerender('sess-bg');
    expect(result.current.extensionUiRequest?.requestId).toBe('req-bg');
  });

  it('keeps typed answers with their own question across session switches', () => {
    const result = renderRequests('sess-a');
    act(() => {
      result.current.showExtensionUiRequest(question('sess-a', 'req-a'));
      result.current.showExtensionUiRequest(question('sess-b', 'req-b'));
    });
    act(() => result.current.setExtensionUiInput('answer for a'));
    result.rerender('sess-b');
    expect(result.current.extensionUiInput).toBe('');
    result.rerender('sess-a');
    expect(result.current.extensionUiInput).toBe('answer for a');
  });

  it('clears only the finished session question', () => {
    const result = renderRequests('sess-a');
    act(() => {
      result.current.showExtensionUiRequest(question('sess-a', 'req-a'));
      result.current.showExtensionUiRequest(question('sess-b', 'req-b'));
    });
    act(() => result.current.clearExtensionUiRequestForSession('sess-b'));
    expect(result.current.extensionUiRequest?.requestId).toBe('req-a');
    expect(result.current.extensionUiQuestionSessionIds).toEqual(['sess-a']);
    let cleared = true;
    act(() => {
      cleared = result.current.clearExtensionUiRequest('req-stale');
    });
    expect(cleared).toBe(false);
  });
});
