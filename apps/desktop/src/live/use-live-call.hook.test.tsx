// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, HostServerMessage, LiveCallView } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import { useLiveCall, type LiveCallController } from './use-live-call.js';
import type { LivePeer, LivePeerSnapshot } from './live-peer.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function liveCall(id: string): LiveCallView {
  return {
    callId: id,
    revision: 1,
    phase: 'active',
    boundSessionId: 's1',
    boundSessionLabel: 'Work',
    ownerDeviceId: 'local',
    providerId: 'openai-codex',
    mediaDriverId: 'codex-webrtc-v1',
    voiceModelId: 'gpt-live-1-codex',
    startedAt: '2026-08-29T00:00:00.000Z',
  };
}

class FakeLiveHost {
  readonly listeners = new Set<(message: HostServerMessage) => void>();
  slot: LiveCallView | null = null;
  ended: string[] = [];
  rebinds: string[] = [];
  rebindRevisions: number[] = [];
  startFailure: string | null = null;
  /** When set, every rebind fails with this code (no slot mutation). */
  rebindFailure: string | null = null;
  /** Return `live-conflict` this many times before applying a successful rebind. */
  rebindConflictTimes = 0;
  /** When false, success still returns `data.call` but skips `voice/live-updated`. */
  emitRebindPush = true;
  selectedProviderId = 'openai-codex';
  mediaDriverId: 'codex-webrtc-v1' | 'gemini-live-v1beta' = 'codex-webrtc-v1';
  lastStartProviderId: string | null = null;

  getTransport(): 'mock' {
    return 'mock';
  }

  subscribe(listener: (message: HostServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async request(command: HostCommand): Promise<HostResponse> {
    if (command.type === 'voice/live/status') {
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          ready: true,
          selectedProviderId: this.selectedProviderId,
          settingsRevision: 1,
          mediaKind: this.mediaDriverId === 'gemini-live-v1beta' ? 'pcm-websocket' : 'webrtc-sdp',
          mediaDriverId: this.mediaDriverId,
          missing: [],
          call: this.slot,
        },
      };
    }
    if (command.type === 'voice/live/end') {
      this.ended.push(command.input.callId ?? 'owner');
      this.slot = null;
      this.emit({ type: 'voice/live-updated', call: null });
      return { type: 'response', command: command.type, success: true, data: { ended: true } };
    }
    if (command.type === 'voice/live/start') {
      this.lastStartProviderId = command.input.providerId;
      if (this.startFailure) {
        this.emit({
          type: 'voice/live-owner-action',
          callId: 'pending',
          action: 'release-media',
        });
        this.emit({ type: 'voice/live-updated', call: null });
        return { type: 'response', command: command.type, success: false, error: this.startFailure };
      }
      this.slot = { ...liveCall('c-started'), phase: 'starting' };
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          call: this.slot,
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', answerSdp: 'v=0\n' },
        },
      };
    }
    if (command.type === 'voice/live/report-event') {
      return { type: 'response', command: command.type, success: true, data: { ok: true } };
    }
    if (command.type === 'voice/live/rebind') {
      if (!this.slot || this.slot.callId !== command.input.callId) {
        return { type: 'response', command: command.type, success: false, error: 'live-session-unavailable' };
      }
      this.rebinds.push(command.input.sessionId);
      this.rebindRevisions.push(command.input.expectedRevision ?? this.slot.revision);
      if (this.rebindFailure) {
        return { type: 'response', command: command.type, success: false, error: this.rebindFailure };
      }
      if (this.rebindConflictTimes > 0) {
        this.rebindConflictTimes -= 1;
        return { type: 'response', command: command.type, success: false, error: 'live-conflict' };
      }
      this.slot = {
        ...this.slot,
        revision: this.slot.revision + 1,
        boundSessionId: command.input.sessionId,
        boundSessionLabel: command.input.sessionId,
        ...(this.slot.activity === 'agent-working' ? { activity: 'listening' as const } : {}),
      };
      if (this.emitRebindPush) {
        this.emit({ type: 'voice/live-updated', call: this.slot });
      }
      return { type: 'response', command: command.type, success: true, data: { call: this.slot } };
    }
    return { type: 'response', command: command.type, success: false, error: 'unused' };
  }

  emit(message: HostServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}

class FakePeer {
  appended: string[] = [];
  private snapshotValue: LivePeerSnapshot = {
    phase: 'idle',
    muted: false,
    errorCode: null,
  };
  private listeners = new Set<(snapshot: LivePeerSnapshot) => void>();
  private abort: AbortController | null = null;

  subscribe(listener: (snapshot: LivePeerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => this.listeners.delete(listener);
  }

  snapshot(): LivePeerSnapshot {
    return this.snapshotValue;
  }

  async start(input: Parameters<LivePeer['start']>[0]): Promise<void> {
    this.abort = new AbortController();
    this.setPhase('negotiating');
    try {
      const result = await input.negotiate('v=0\n', this.abort.signal);
      if (this.abort.signal.aborted) throw new DOMException('aborted', 'AbortError');
      void result;
      this.setPhase('connected');
    } catch (error: unknown) {
      if (
        this.abort?.signal.aborted &&
        !(error instanceof Error && error.message.startsWith('live-'))
      ) {
        throw new DOMException('aborted', 'AbortError');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = null;
    this.setPhase('ended');
  }

  setMuted(): void {}
  sendDelegationAck(): void {}
  sendContextAppend(input: { content: string }): void {
    this.appended.push(input.content);
  }
  dispose(): void {}

  private setPhase(phase: LivePeerSnapshot['phase']): void {
    this.snapshotValue = { ...this.snapshotValue, phase };
    for (const listener of this.listeners) listener(this.snapshotValue);
  }
}

describe('useLiveCall hangup', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  function mount(
    host: FakeLiveHost,
    peer?: FakePeer,
    extras?: {
      lastAssistant?: { messageId: string; text: string; done: boolean; toolsRunning: boolean };
      onFail?: (error: string) => void;
    },
  ): { current: LiveCallController | null } {
    const probe = { current: null as LiveCallController | null };
    function Probe(): ReactElement {
      const live = useLiveCall({
        hostClient: host as unknown as HostClient,
        sessionId: 's1',
        sessionStreaming: false,
        ...(extras?.lastAssistant ? { lastAssistant: extras.lastAssistant } : {}),
        ...(peer ? { createPeer: () => peer as unknown as LivePeer } : {}),
        ...(extras?.onFail ? { onFail: extras.onFail } : {}),
      });
      useEffect(() => {
        probe.current = live;
      });
      return (
        <>
          <button type="button" data-testid="start" onClick={() => void live.start()} />
          <button type="button" data-testid="end" onClick={() => void live.end()} />
        </>
      );
    }
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    const next = createRoot(hostEl);
    act(() => {
      next.render(<Probe />);
    });
    root = next;
    container = hostEl;
    return probe;
  }

  it('starts the Host-selected Gemini channel instead of defaulting to Codex', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => new MediaStream(),
      },
    });
    const host = new FakeLiveHost();
    host.selectedProviderId = 'google-gemini';
    host.mediaDriverId = 'gemini-live-v1beta';
    host.startFailure = 'live-protocol-failed';
    const probe = mount(host, new FakePeer());
    await act(async () => {
      await Promise.resolve();
      container?.querySelector<HTMLButtonElement>('[data-testid="start"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.lastStartProviderId).toBe('google-gemini');
    expect(probe.current?.starting).toBe(false);
  });

  it('does not adopt a late Host call after hangup', async () => {
    const host = new FakeLiveHost();
    const probe = mount(host);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="end"]')?.click();
      await Promise.resolve();
    });
    expect(host.ended).toEqual([]);
    const late = liveCall('late-1');
    host.slot = late;
    act(() => {
      host.emit({ type: 'voice/live-updated', call: late });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(probe.current?.call).toBeNull();
    expect(host.ended).toContain('late-1');
  });

  it('silently reaps a leftover Host call on mount without blocking start', async () => {
    const host = new FakeLiveHost();
    host.slot = liveCall('stale-1');
    const failed: string[] = [];
    const probe = mount(host, new FakePeer(), { onFail: (error) => failed.push(error) });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.ended).toContain('stale-1');
    expect(failed).toEqual([]);
    expect(probe.current?.call).toBeNull();
    expect(probe.current?.error).toBeNull();
    expect(probe.current?.canStart).toBe(true);
  });

  it('releases media but retains the Host create error for retry', async () => {
    const host = new FakeLiveHost();
    host.startFailure = 'live-provider-access-denied';
    const failed: string[] = [];
    const probe = mount(host, new FakePeer(), { onFail: (error) => failed.push(error) });
    await act(async () => {
      await Promise.resolve();
      container?.querySelector<HTMLButtonElement>('[data-testid="start"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(probe.current?.starting).toBe(false);
    expect(probe.current?.call).toBeNull();
    expect(probe.current?.error).toBe('live-provider-access-denied');
    expect(failed).toEqual(['live-provider-access-denied']);
  });

  it('does not guess a result from an existing assistant bubble; only relays Host results', async () => {
    const host = new FakeLiveHost();
    const peer = new FakePeer();
    const probe = mount(host, peer, {
      lastAssistant: {
        messageId: 'a1',
        text: '洛杉矶今天晴，大约 24 度。',
        done: true,
        toolsRunning: false,
      },
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="start"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      host.emit({
        type: 'voice/live-updated',
        call: { ...liveCall('c-started'), activity: 'agent-working' },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(peer.appended).toEqual([]);
    expect(probe.current?.call?.activity).toBe('agent-working');
    act(() => {
      host.emit({ type: 'voice/live-owner-action', callId: 'c-started',
        action: 'append-context', target: 'delegation', channel: 'speakable',
        providerDelegationId: 'd1', content: 'Host result', });
      host.emit({ type: 'voice/live-owner-action', callId: 'old-call',
        action: 'append-context', content: 'stale result', });
    });
    expect(peer.appended).toEqual(['Host result']);
  });

  it('does not feed another session into the bound Live call', async () => {
    const host = new FakeLiveHost();
    const peer = new FakePeer();
    function Probe(): ReactElement {
      const [viewedSessionId, setViewedSessionId] = useState('s1');
      const [assistant, setAssistant] = useState({
        messageId: 'a1',
        text: '洛杉矶今天晴，大约 24 度。',
        done: true,
        toolsRunning: false,
      });
      const live = useLiveCall({
        hostClient: host as unknown as HostClient,
        sessionId: viewedSessionId,
        sessionStreaming: false,
        lastAssistant: assistant,
        createPeer: () => peer as unknown as LivePeer,
      });
      return (
        <>
          <button type="button" data-testid="start" onClick={() => void live.start()} />
          <button
            type="button"
            data-testid="switch"
            onClick={() => {
              setViewedSessionId('s2');
              setAssistant({
                messageId: 'b1',
                text: '另一会话的回复',
                done: true,
                toolsRunning: false,
              });
            }}
          />
        </>
      );
    }
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    const next = createRoot(hostEl);
    act(() => {
      next.render(<Probe />);
    });
    root = next;
    container = hostEl;
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="start"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="switch"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      host.emit({
        type: 'voice/live-updated',
        call: { ...liveCall('c-started'), activity: 'agent-working' },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(peer.appended.some((text) => text.includes('另一会话'))).toBe(false);
    expect(peer.appended.some((text) => text.includes('洛杉矶今天晴'))).toBe(false);
    expect(host.rebinds).toEqual(['s2']);
  });

  async function startThenSwitchSession(input: {
    host: FakeLiveHost;
    peer?: FakePeer;
    nextSessionId?: string;
  }): Promise<{ current: LiveCallController | null }> {
    const probe = { current: null as LiveCallController | null };
    const peer = input.peer ?? new FakePeer();
    function Probe(): ReactElement {
      const [viewedSessionId, setViewedSessionId] = useState('s1');
      const live = useLiveCall({
        hostClient: input.host as unknown as HostClient,
        sessionId: viewedSessionId,
        sessionStreaming: false,
        createPeer: () => peer as unknown as LivePeer,
      });
      useEffect(() => {
        probe.current = live;
      });
      return (
        <>
          <button type="button" data-testid="start" onClick={() => void live.start()} />
          <button
            type="button"
            data-testid="switch"
            onClick={() => setViewedSessionId(input.nextSessionId ?? 's2')}
          />
        </>
      );
    }
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    const next = createRoot(hostEl);
    act(() => {
      next.render(<Probe />);
    });
    root = next;
    container = hostEl;
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="start"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="switch"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return probe;
  }

  it('updates boundSessionId from rebind response without waiting for voice/live-updated', async () => {
    const host = new FakeLiveHost();
    host.emitRebindPush = false;
    const probe = await startThenSwitchSession({ host });
    expect(host.rebinds).toEqual(['s2']);
    expect(probe.current?.call?.boundSessionId).toBe('s2');
    expect(probe.current?.error).toBeNull();
  });

  it('surfaces non-conflict rebind failures on live.error', async () => {
    const host = new FakeLiveHost();
    host.rebindFailure = 'live-session-unavailable';
    const probe = await startThenSwitchSession({ host });
    expect(host.rebinds).toEqual(['s2']);
    expect(probe.current?.call?.boundSessionId).toBe('s1');
    expect(probe.current?.error).toBe('live-session-unavailable');
  });

  it('retries live-conflict with latest revision then surfaces the error', async () => {
    const host = new FakeLiveHost();
    host.rebindFailure = 'live-conflict';
    const probe = await startThenSwitchSession({ host });
    expect(host.rebinds).toEqual(['s2', 's2', 's2']);
    expect(host.rebindRevisions).toEqual([1, 1, 1]);
    expect(probe.current?.call?.boundSessionId).toBe('s1');
    expect(probe.current?.error).toBe('live-conflict');
  });
});
