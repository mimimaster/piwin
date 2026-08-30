// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect, type ReactElement } from 'react';
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
  startFailure: string | null = null;
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

  it('closes Live and reports the Host create error instead of staying red', async () => {
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
    expect(probe.current?.error).toBeNull();
    expect(failed).toEqual(['live-provider-access-denied']);
  });

  it('feeds the finished assistant bubble back to Live without waiting for Host', async () => {
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
    expect(peer.appended.some((text) => text.includes('洛杉矶今天晴'))).toBe(true);
    expect(probe.current?.call?.activity).toBe('listening');
  });
});
