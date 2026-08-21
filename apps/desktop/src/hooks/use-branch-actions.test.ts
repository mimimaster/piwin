// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  buildBranchPromptInput,
  isBranchPromptCommand,
  useBranchActions,
  type UseBranchActionsArgs,
} from './use-branch-actions.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('buildBranchPromptInput', () => {
  it('sends branchFromMessageId and never a truncate command', () => {
    const input = buildBranchPromptInput({
      text: 'try again',
      branchFromMessageId: 'u2',
      clientMessageId: 'client-1',
      agentMode: 'agent',
      selectedModelKey: 'openai::gpt',
      modelOptions: [
        {
          providerId: 'openai',
          protocol: 'openai-compatible',
          modelId: 'gpt',
          label: 'GPT',
        },
      ],
    });
    expect(input.branchFromMessageId).toBe('u2');
    expect(input.text).toBe('try again');
    expect(input.clientMessageId).toBe('client-1');
    expect(isBranchPromptCommand({ type: 'session/prompt', sessionId: 's1', input })).toBe(true);
    expect(isBranchPromptCommand({ type: 'session/truncate-from', sessionId: 's1', messageId: 'u2' })).toBe(
      false,
    );
  });
});

describe('switch confirmation (ADR 0055 write boundary)', () => {
  it('opens the confirm card, then re-sends the switch with confirm', async () => {
    const sent: HostCommand[] = [];
    const hostClient = {
      request: async (command: HostCommand): Promise<HostResponse> => {
        sent.push(command);
        if (command.type === 'session/branch-switch') {
          return response(
            command.confirm === true
              ? { status: 'switched', sessionId: 's1', activeLeafMessageId: 'u2-alt', messages: [] }
              : {
                  status: 'needs-confirmation',
                  offPathWrites: { files: ['src/app.ts'], hasUnknownWrites: false },
                },
          );
        }
        return response({ sessionId: 's1', branchPoints: [] });
      },
      subscribe: () => () => undefined,
    };
    const actions = renderBranchActions(hostClient);

    await act(async () => {
      await actions.current?.switchBranch('u2-alt');
    });
    expect(actions.current?.pendingSwitchConfirm).toEqual({
      targetMessageId: 'u2-alt',
      offPathWrites: { files: ['src/app.ts'], hasUnknownWrites: false },
    });

    await act(async () => {
      actions.current?.confirmSwitchBranch();
    });
    expect(
      sent.filter((command) => command.type === 'session/branch-switch').at(-1),
    ).toMatchObject({ targetMessageId: 'u2-alt', confirm: true });
    expect(actions.current?.pendingSwitchConfirm).toBeNull();
  });
});

function response(data: unknown): HostResponse {
  return { id: 'r1', type: 'response', command: 'session/branch-switch', success: true, data };
}

/** Renders the hook in a throwaway probe so the state machine can be driven. */
function renderBranchActions(
  hostClient: UseBranchActionsArgs['hostClient'],
): { current: ReturnType<typeof useBranchActions> | null } {
  const actions: { current: ReturnType<typeof useBranchActions> | null } = { current: null };
  function Probe(): null {
    actions.current = useBranchActions({
      hostClient,
      activeSessionId: 's1',
      streaming: false,
      projectTrusted: true,
      isGeneralScope: false,
      transcriptOwnerSessionId: 's1',
      visibleMessages: [],
      dispatch: vi.fn(),
      dispatchNotification: vi.fn(),
      setEditingMessageId: vi.fn(),
      locale: 'en',
      selectedModelKey: 'openai::gpt',
      modelOptions: [],
      agentMode: 'agent',
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(createElement(Probe));
  });
  return actions;
}
