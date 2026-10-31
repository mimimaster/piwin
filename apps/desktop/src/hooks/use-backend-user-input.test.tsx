// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useBackendUserInput, type BackendUserInputPromptState } from './use-backend-user-input.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function prompt(sessionId: string, requestId: string): BackendUserInputPromptState {
  return {
    sessionId,
    requestId,
    generationId: 'gen-1',
    request: { title: 'Q', questions: [{ id: 'name', prompt: 'Name', type: 'text' }] },
  };
}

function HookProbe(props: {
  activeSessionId: string | null;
  onReady: (api: ReturnType<typeof useBackendUserInput>) => void;
}): null {
  props.onReady(useBackendUserInput(props.activeSessionId));
  return null;
}

describe('useBackendUserInput', () => {
  it('shows only the active session request and drops background ones on clear', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let api: ReturnType<typeof useBackendUserInput> | undefined;
    act(() => {
      root.render(
        <HookProbe activeSessionId="sess-a" onReady={(next) => { api = next; }} />,
      );
    });
    act(() => {
      api?.showBackendUserInput(prompt('sess-b', 'req-bg'));
      api?.showBackendUserInput(prompt('sess-a', 'req-a'));
    });
    expect(api?.backendUserInput?.requestId).toBe('req-a');
    act(() => {
      api?.clearBackendUserInput('req-a');
    });
    expect(api?.backendUserInput).toBeNull();
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
