// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type {
  HostCommand,
  HostResponse,
  PromptAttachment,
  PromptContextRef,
} from '@piwin/contracts';
import type { ChatMessageUi } from '../chat-reducer.js';
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

  it('carries contextRefs through when the edited turn had any', () => {
    const contextRefs: PromptContextRef[] = [
      { kind: 'selection', snapshotText: 'quoted body', label: 'quoted body' },
    ];
    const input = buildBranchPromptInput({
      text: 'try again',
      branchFromMessageId: 'u2',
      clientMessageId: 'client-1',
      agentMode: 'agent',
      selectedModelKey: 'openai::gpt',
      modelOptions: [],
      contextRefs,
    });
    expect(input.contextRefs).toEqual(contextRefs);
  });

  it('omits contextRefs when the edited turn had none', () => {
    const input = buildBranchPromptInput({
      text: 'try again',
      branchFromMessageId: 'u2',
      clientMessageId: 'client-1',
      agentMode: 'agent',
      selectedModelKey: 'openai::gpt',
      modelOptions: [],
    });
    expect(input.contextRefs).toBeUndefined();
  });

  it('carries attachments through when the edited turn had any', () => {
    const attachments = [mediaAttachment('img-1')];
    const input = buildBranchPromptInput({
      text: 'try again',
      branchFromMessageId: 'u2',
      clientMessageId: 'client-1',
      agentMode: 'agent',
      selectedModelKey: 'openai::gpt',
      modelOptions: [],
      attachments,
    });
    expect(input.attachments).toEqual(attachments);
  });

  it('omits attachments when the edited turn had none', () => {
    const input = buildBranchPromptInput({
      text: 'try again',
      branchFromMessageId: 'u2',
      clientMessageId: 'client-1',
      agentMode: 'agent',
      selectedModelKey: 'openai::gpt',
      modelOptions: [],
    });
    expect(input.attachments).toBeUndefined();
  });
});

describe('branchResend (Edit this turn / revert)', () => {
  it('keeps the original context refs on both the optimistic bubble and the Host prompt', async () => {
    const contextRefs: PromptContextRef[] = [
      { kind: 'selection', snapshotText: 'quoted body', label: 'quoted body' },
    ];
    const originalMessage: ChatMessageUi = {
      id: 'u1',
      role: 'user',
      text: 'original text',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      contextRefs,
    };
    const sent: HostCommand[] = [];
    const dispatch = vi.fn();
    const hostClient = {
      request: async (command: HostCommand): Promise<HostResponse> => {
        sent.push(command);
        if (command.type === 'session/prompt') {
          return response({ runId: 'run-1' });
        }
        return response({ sessionId: 's1', branchPoints: [] });
      },
      subscribe: () => () => undefined,
    };
    const actions = renderBranchActions(hostClient, {
      visibleMessages: [originalMessage],
      dispatch,
    });

    await act(async () => {
      await actions.current?.branchResend('u1', 'edited text');
    });

    // Optimistic bubble: the resend must not silently drop the quote/pin.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user/send', text: 'edited text', contextRefs }),
    );

    // Host-persisted prompt: what gets stored in the transcript must match.
    const promptCommand = sent.find(
      (command): command is Extract<HostCommand, { type: 'session/prompt' }> =>
        command.type === 'session/prompt',
    );
    expect(promptCommand?.input.contextRefs).toEqual(contextRefs);
  });

  it('keeps the original attachments on both the optimistic bubble and the Host prompt', async () => {
    const attachments = [mediaAttachment('img-1')];
    const originalMessage: ChatMessageUi = {
      id: 'u1',
      role: 'user',
      text: 'look at this',
      thinking: '',
      tools: [],
      attachments,
      status: 'done',
    };
    const sent: HostCommand[] = [];
    const dispatch = vi.fn();
    const hostClient = {
      request: async (command: HostCommand): Promise<HostResponse> => {
        sent.push(command);
        if (command.type === 'session/prompt') {
          return response({ runId: 'run-1' });
        }
        return response({ sessionId: 's1', branchPoints: [] });
      },
      subscribe: () => () => undefined,
    };
    const actions = renderBranchActions(hostClient, {
      visibleMessages: [originalMessage],
      dispatch,
    });

    await act(async () => {
      await actions.current?.branchResend('u1', 'look at this again');
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user/send', text: 'look at this again', attachments }),
    );
    const promptCommand = sent.find(
      (command): command is Extract<HostCommand, { type: 'session/prompt' }> =>
        command.type === 'session/prompt',
    );
    expect(promptCommand?.input.attachments).toEqual(attachments);
  });

  it('allows an image-only resend when the original turn had attachments and no text', async () => {
    const attachments = [mediaAttachment('img-1')];
    const originalMessage: ChatMessageUi = {
      id: 'u1',
      role: 'user',
      text: '',
      thinking: '',
      tools: [],
      attachments,
      status: 'done',
    };
    const sent: HostCommand[] = [];
    const dispatch = vi.fn();
    const hostClient = {
      request: async (command: HostCommand): Promise<HostResponse> => {
        sent.push(command);
        if (command.type === 'session/prompt') {
          return response({ runId: 'run-1' });
        }
        return response({ sessionId: 's1', branchPoints: [] });
      },
      subscribe: () => () => undefined,
    };
    const actions = renderBranchActions(hostClient, {
      visibleMessages: [originalMessage],
      dispatch,
    });

    await act(async () => {
      await actions.current?.branchResend('u1', '   ');
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user/send', text: '', attachments }),
    );
    const promptCommand = sent.find(
      (command): command is Extract<HostCommand, { type: 'session/prompt' }> =>
        command.type === 'session/prompt',
    );
    expect(promptCommand?.input.text).toBe('');
    expect(promptCommand?.input.attachments).toEqual(attachments);
  });

  it('does not send when the edited turn has neither text nor attachments', async () => {
    const originalMessage: ChatMessageUi = {
      id: 'u1',
      role: 'user',
      text: 'original text',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const sent: HostCommand[] = [];
    const dispatch = vi.fn();
    const hostClient = {
      request: async (command: HostCommand): Promise<HostResponse> => {
        sent.push(command);
        return response({ sessionId: 's1', branchPoints: [] });
      },
      subscribe: () => () => undefined,
    };
    const actions = renderBranchActions(hostClient, {
      visibleMessages: [originalMessage],
      dispatch,
    });

    await act(async () => {
      await actions.current?.branchResend('u1', '   ');
    });

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'user/send' }));
    expect(sent.some((command) => command.type === 'session/prompt')).toBe(false);
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

function mediaAttachment(id: string): PromptAttachment {
  return {
    id,
    kind: 'media',
    path: `/Users/test/.piwin/media/${id}.png`,
    mimeType: 'image/png',
    byteSize: 2048,
    source: 'paste',
  };
}

function response(data: unknown): HostResponse {
  return { id: 'r1', type: 'response', command: 'session/branch-switch', success: true, data };
}

/** Renders the hook in a throwaway probe so the state machine can be driven. */
function renderBranchActions(
  hostClient: UseBranchActionsArgs['hostClient'],
  overrides: Partial<UseBranchActionsArgs> = {},
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
      ...overrides,
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
