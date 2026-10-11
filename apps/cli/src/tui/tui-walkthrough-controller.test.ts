import type { Component } from '@earendil-works/pi-tui';
import type { HostCommand, HostResponse, WalkthroughArtifact } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent, type TranscriptState } from './transcript-model.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { TuiWalkthroughController, findLatestAnswer, pickWalkthrough } from './tui-walkthrough-controller.js';

const ENTER = '\r';
const DOWN = '\x1b[B';

function answered(): TranscriptState {
  let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', '加一个登录页');
  state = applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
  state = applyAgentEvent(state, { type: 'message/end', messageId: 'a1' } as never);
  return state;
}

function artifact(patch: Partial<WalkthroughArtifact> & { status: WalkthroughArtifact['status'] }): WalkthroughArtifact {
  return {
    version: 1,
    id: 'w1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'standard',
    sourceHash: 'h',
    createdAt: '2026-10-08T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
    ...patch,
  } as WalkthroughArtifact;
}

class FakeModals {
  public current: (Component & { handleInput?: (data: string) => void }) | undefined;
  public show(component: Component): void {
    this.current = component;
  }
  public close(): void {
    this.current = undefined;
  }
  public press(...keys: string[]): void {
    for (const key of keys) this.current?.handleInput?.(key);
  }
  public text(): string {
    return (this.current?.render(80) ?? []).join('\n');
  }
}

function setup(options: { artifacts?: WalkthroughArtifact[]; transcript?: TranscriptState; generateError?: string } = {}) {
  const commands: HostCommand[] = [];
  const request = async (command: HostCommand): Promise<HostResponse> => {
    commands.push(command);
    if (command.type === 'walkthrough/generate' && options.generateError !== undefined) {
      return { type: 'response', command: command.type, success: false, error: options.generateError };
    }
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: command.type === 'walkthrough/list' ? { sessionId: 's1', artifacts: options.artifacts ?? [] } : {},
    };
  };
  const modals = new FakeModals();
  const port = { onChanged: vi.fn(), onHint: vi.fn(), onNotice: vi.fn(), onError: vi.fn() };
  const controller = new TuiWalkthroughController({
    link: { request } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
    getSessionId: () => 's1',
    getTranscript: () => options.transcript ?? answered(),
    ...port,
  });
  const sent = (type: HostCommand['type']): HostCommand[] => commands.filter((command) => command.type === type);
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return { controller, modals, port, sent, settle };
}

describe('walkthrough selection', () => {
  it('writes about the latest finished answer', () => {
    expect(findLatestAnswer(answered())).toEqual({ messageId: 'a1', runId: 'run-1' });
    const streaming = applyAgentEvent(answered(), { type: 'message/start', messageId: 'a2', role: 'assistant' });
    expect(findLatestAnswer(streaming)?.messageId).toBe('a1');
    expect(findLatestAnswer(EMPTY_TRANSCRIPT)).toBeUndefined();
  });

  it('takes the newest walkthrough of a message', () => {
    const picked = pickWalkthrough(
      [
        artifact({ status: 'error', id: 'old', updatedAt: '2026-10-08T00:00:00Z' } as never),
        artifact({ status: 'ready', id: 'new', updatedAt: '2026-10-08T01:00:00Z', markdown: 'x' } as never),
        artifact({ status: 'ready', id: 'other', messageId: 'a9', updatedAt: '2026-10-09T00:00:00Z' } as never),
      ],
      'a1',
    );
    expect(picked?.id).toBe('new');
  });
});

describe('TuiWalkthroughController', () => {
  it('asks for a report when there is none and announces it when it lands', async () => {
    const { controller, sent, port } = setup();
    await controller.open(false);
    expect(sent('walkthrough/generate')).toEqual([
      { type: 'walkthrough/generate', sessionId: 's1', messageId: 'a1', runId: 'run-1' },
    ]);
    expect(controller.describe()).toBe('报告生成中…');
    controller.handlePush({
      type: 'walkthrough/updated',
      sessionId: 's1',
      artifact: artifact({ status: 'ready', markdown: '# 报告' } as never),
    });
    expect(port.onNotice).toHaveBeenCalledWith('info', '交付报告已生成 · /walkthrough 查看');
    expect(controller.describe()).toBeUndefined();
  });

  it('shows an existing report instead of writing another', async () => {
    const ready = artifact({ status: 'ready', markdown: '# 做了什么\n加了登录页' } as never);
    const { controller, modals, sent } = setup({ artifacts: [ready] });
    await controller.open(false);
    expect(sent('walkthrough/generate')).toEqual([]);
    expect(modals.text()).toContain('加了登录页');
  });

  it('writes a new one over an existing report when asked', async () => {
    const ready = artifact({ status: 'ready', markdown: 'old' } as never);
    const { controller, sent } = setup({ artifacts: [ready] });
    await controller.open(true);
    expect(sent('walkthrough/generate')[0]).toMatchObject({ force: true });
  });

  it('offers to cancel a report that is still being written', async () => {
    const generating = artifact({ status: 'generating', generationId: 'g1' } as never);
    const { controller, modals, sent, settle } = setup({ artifacts: [generating] });
    await controller.open(false);
    modals.press(DOWN, ENTER);
    await settle();
    expect(sent('walkthrough/cancel')).toEqual([
      { type: 'walkthrough/cancel', sessionId: 's1', messageId: 'a1', generationId: 'g1' },
    ]);
  });

  it('reports the Host’s reason when a report cannot be written', async () => {
    const { controller, port } = setup({ generateError: 'Walkthrough is disabled' });
    await controller.open(false);
    expect(port.onNotice).toHaveBeenCalledWith('error', '交付报告没有生成 — Walkthrough is disabled');
    expect(controller.describe()).toBeUndefined();
  });

  it('stays quiet about reports it did not ask for and says so when there is no answer', async () => {
    const { controller, port } = setup({ transcript: EMPTY_TRANSCRIPT });
    await controller.open(false);
    expect(port.onHint).toHaveBeenCalledWith('还没有可以写报告的回答');
    controller.handlePush({
      type: 'walkthrough/updated',
      sessionId: 's1',
      artifact: artifact({ status: 'ready', markdown: 'x' } as never),
    });
    expect(port.onNotice).not.toHaveBeenCalled();
  });
});
