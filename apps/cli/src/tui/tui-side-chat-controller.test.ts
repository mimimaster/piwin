import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent, type TranscriptState } from './transcript-model.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { TuiSideChatController, findHandoffMessage } from './tui-side-chat-controller.js';

function answered(text: string): TranscriptState {
  let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', '问题');
  state = applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant' });
  state = applyAgentEvent(state, { type: 'message/text_delta', messageId: 'a1', delta: text });
  return applyAgentEvent(state, { type: 'message/end', messageId: 'a1' } as never);
}

function setup(options: { existing?: Array<{ id: string; name: string }> } = {}) {
  const commands: HostCommand[] = [];
  const screen = { sessionId: 'main' as string | undefined, transcript: EMPTY_TRANSCRIPT, running: false };
  const request = async (command: HostCommand): Promise<HostResponse> => {
    commands.push(command);
    const data =
      command.type === 'side-chat/list'
        ? { sessions: options.existing ?? [] }
        : command.type === 'side-chat/open'
          ? { sideChatSessionId: 'side-1' }
          : {};
    return { type: 'response', command: command.type, success: true, data };
  };
  const port = { onChanged: vi.fn(), onHint: vi.fn(), onNotice: vi.fn(), onError: vi.fn() };
  const controller = new TuiSideChatController({
    link: { request } as unknown as TuiHostLink,
    modals: { show: vi.fn(), close: vi.fn() } as unknown as TuiModalStack,
    getSessionId: () => screen.sessionId,
    getTranscript: () => screen.transcript,
    isRunning: () => screen.running,
    openSession: async (sessionId) => {
      screen.sessionId = sessionId;
      screen.transcript = EMPTY_TRANSCRIPT;
    },
    ...port,
  });
  const sent = (type: HostCommand['type']): HostCommand[] => commands.filter((command) => command.type === type);
  return { controller, screen, port, sent };
}

describe('findHandoffMessage', () => {
  it('takes the latest finished answer that says something', () => {
    expect(findHandoffMessage(answered('用 SQLite 就够了'))).toEqual({ messageId: 'a1', preview: '用 SQLite 就够了' });
    expect(findHandoffMessage(answered('   '))).toBeUndefined();
    expect(findHandoffMessage(EMPTY_TRANSCRIPT)).toBeUndefined();
  });
});

describe('TuiSideChatController', () => {
  it('opens a side chat of the session on screen and steps into it', async () => {
    const { controller, screen, sent } = setup();
    await controller.open('');
    expect(sent('side-chat/open')).toEqual([{ type: 'side-chat/open', sourceSessionId: 'main' }]);
    expect(screen.sessionId).toBe('side-1');
    expect(controller.describe()).toBe('侧聊 · /back 返回');
  });

  it('names a new side chat when asked and skips the list', async () => {
    const { controller, sent } = setup({ existing: [{ id: 'side-0', name: '旧的' }] });
    await controller.open('调研缓存');
    expect(sent('side-chat/list')).toEqual([]);
    expect(sent('side-chat/open')[0]).toMatchObject({ name: '调研缓存' });
  });

  it('returns to the session it came from', async () => {
    const { controller, screen } = setup();
    await controller.open('');
    await controller.back();
    expect(screen.sessionId).toBe('main');
    expect(controller.describe()).toBeUndefined();
  });

  it('carries the latest answer back as a ref only the source session can spend', async () => {
    const { controller, screen, port } = setup();
    await controller.open('');
    screen.transcript = answered('用 SQLite 就够了');
    await controller.handoffLatest();
    expect(screen.sessionId).toBe('main');
    expect(controller.describe()).toBe('带回侧聊回答 1');
    expect(port.onNotice).toHaveBeenLastCalledWith('info', '侧聊的回答会随下一条消息带给主会话：用 SQLite 就够了');

    screen.sessionId = 'elsewhere';
    expect(controller.takeRefs()).toEqual([]);
    screen.sessionId = 'main';
    const refs = controller.takeRefs();
    expect(refs).toEqual([
      { kind: 'side-chat-message', sideChatSessionId: 'side-1', messageId: 'a1', label: '用 SQLite 就够了' },
    ]);
    expect(controller.takeRefs()).toEqual([]);
    controller.restoreRefs(refs);
    expect(controller.describe()).toBe('带回侧聊回答 1');
  });

  it('stops being "inside" when the user switches sessions another way', async () => {
    const { controller, screen, port } = setup();
    await controller.open('');
    screen.sessionId = 'some-other-session';
    expect(controller.describe()).toBeUndefined();
    await controller.back();
    expect(port.onHint).toHaveBeenCalledWith('现在不在侧聊里');
  });

  it('refuses side-chat-only commands outside a side chat', async () => {
    const { controller, port, sent } = setup();
    await controller.sync();
    await controller.handoffLatest();
    expect(sent('side-chat/sync')).toEqual([]);
    expect(port.onHint).toHaveBeenCalledWith('只有在侧聊里才需要同步');
    expect(port.onHint).toHaveBeenCalledWith('只有在侧聊里才能把回答带回主会话');
  });
});
