// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  LiveCallView,
  LiveMediaDriverId,
  LiveOwnerEvent,
} from '@piwin/contracts';
import type { HostClient, HostClientState } from '@piwin/host-client';
import {
  useMobileLive,
  type MobileLiveCallController,
} from './use-mobile-live.js';
import type {
  MobileLiveMediaDriver,
  MobileLivePeerSnapshot,
} from '../live/mobile-live-media-driver.js';

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
  readonly pushListeners = new Set<(push: HostPush) => void>();
  readonly stateListeners = new Set<(state: HostClientState) => void>();
  slot: LiveCallView | null = null;
  rebinds: string[] = [];
  rebindRevisions: number[] = [];
  rebindFailure: string | null = null;
  rebindConflictTimes = 0;
  emitRebindPush = true;
  /** Optional per-session gate: rebind awaits the promise before applying. */
  rebindBlockers = new Map<string, Promise<void>>();
  selectedProviderId = 'openai-codex';
  mediaDriverId: LiveMediaDriverId = 'codex-webrtc-v1';

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
          mediaKind: 'webrtc-sdp',
          mediaDriverId: this.mediaDriverId,
          missing: [],
          call: this.slot,
        },
      };
    }
    if (command.type === 'voice/live/end') {
      this.slot = null;
      this.emitPush({ type: 'voice/live-updated', call: null });
      return { type: 'response', command: command.type, success: true, data: { ended: true } };
    }
    if (command.type === 'voice/live/start') {
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
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: 'live-session-unavailable',
        };
      }
      this.rebinds.push(command.input.sessionId);
      this.rebindRevisions.push(command.input.expectedRevision ?? this.slot.revision);
      const blocker = this.rebindBlockers.get(command.input.sessionId);
      if (blocker) await blocker;
      if (this.rebindFailure) {
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: this.rebindFailure,
        };
      }
      if (this.rebindConflictTimes > 0) {
        this.rebindConflictTimes -= 1;
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: 'live-conflict',
        };
      }
      this.slot = {
        ...this.slot,
        revision: this.slot.revision + 1,
        boundSessionId: command.input.sessionId,
        boundSessionLabel: command.input.sessionId,
      };
      if (this.emitRebindPush) {
        this.emitPush({ type: 'voice/live-updated', call: this.slot });
      }
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { call: this.slot },
      };
    }
    return { type: 'response', command: command.type, success: false, error: 'unused' };
  }

  subscribePush(listener: (push: HostPush) => void): () => void {
    this.pushListeners.add(listener);
    return () => {
      this.pushListeners.delete(listener);
    };
  }

  subscribeState(listener: (state: HostClientState) => void): () => void {
    this.stateListeners.add(listener);
    listener({ kind: 'ready' });
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  emitPush(push: HostPush): void {
    for (const listener of this.pushListeners) listener(push);
  }
}

class FakeDriver implements MobileLiveMediaDriver {
  id: LiveMediaDriverId = 'codex-webrtc-v1';
  private snapshotValue: MobileLivePeerSnapshot = {
    phase: 'idle',
    muted: false,
    errorCode: null,
  };
  private listeners = new Set<(snapshot: MobileLivePeerSnapshot) => void>();
  private eventListeners = new Set<(event: LiveOwnerEvent) => void>();

  isSupported(): boolean {
    return true;
  }

  snapshot(): MobileLivePeerSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: (snapshot: MobileLivePeerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prepareStart() {
    this.setPhase('acquiring-mic');
    return { mediaDriverId: 'codex-webrtc-v1' as const, offerSdp: 'v=0\n' };
  }

  async connect(): Promise<void> {
    this.setPhase('connected');
  }

  setMuted(): void {}

  async handleOwnerAction(): Promise<void> {}

  subscribeEvents(listener: (event: LiveOwnerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  appendContext(): void {}

  async close(): Promise<void> {
    this.setPhase('ended');
  }

  private setPhase(phase: MobileLivePeerSnapshot['phase']): void {
    this.snapshotValue = { ...this.snapshotValue, phase };
    for (const listener of this.listeners) listener(this.snapshotValue);
  }
}

describe('useMobileLive session rebind', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container?.remove();
    container = null;
  });

  async function startThenSwitchSession(input: {
    host: FakeLiveHost;
    nextSessionId?: string | undefined;
  }): Promise<{ current: MobileLiveCallController | null }> {
    const probe = { current: null as MobileLiveCallController | null };
    const driver = new FakeDriver();
    function Probe(): ReactElement {
      const [viewedSessionId, setViewedSessionId] = useState<string | undefined>('s1');
      const live = useMobileLive({
        hostClient: input.host as unknown as HostClient,
        sessionId: viewedSessionId,
        createDriver: () => driver,
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
            onClick={() => setViewedSessionId(input.nextSessionId)}
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
    const probe = await startThenSwitchSession({ host, nextSessionId: 's2' });
    expect(host.rebinds).toEqual(['s2']);
    expect(probe.current?.call?.boundSessionId).toBe('s2');
    expect(probe.current?.error).toBeNull();
  });

  it('surfaces non-conflict rebind failures on live.error', async () => {
    const host = new FakeLiveHost();
    host.rebindFailure = 'live-session-unavailable';
    const probe = await startThenSwitchSession({ host, nextSessionId: 's2' });
    expect(host.rebinds).toEqual(['s2']);
    expect(probe.current?.call?.boundSessionId).toBe('s1');
    expect(probe.current?.error).toBe('live-session-unavailable');
  });

  it('retries live-conflict with latest revision then surfaces the error', async () => {
    const host = new FakeLiveHost();
    host.rebindFailure = 'live-conflict';
    const probe = await startThenSwitchSession({ host, nextSessionId: 's2' });
    expect(host.rebinds).toEqual(['s2', 's2', 's2']);
    expect(host.rebindRevisions).toEqual([1, 1, 1]);
    expect(probe.current?.call?.boundSessionId).toBe('s1');
    expect(probe.current?.error).toBe('live-conflict');
  });

  it('does not rebind when sessionId becomes undefined', async () => {
    const host = new FakeLiveHost();
    const probe = await startThenSwitchSession({ host, nextSessionId: undefined });
    expect(host.rebinds).toEqual([]);
    expect(probe.current?.call?.boundSessionId).toBe('s1');
    expect(probe.current?.error).toBeNull();
  });

  it('ignores a stale in-flight rebind after the intended session advances', async () => {
    const host = new FakeLiveHost();
    let releaseS2!: () => void;
    host.rebindBlockers.set(
      's2',
      new Promise<void>((resolve) => {
        releaseS2 = resolve;
      }),
    );
    const probe = { current: null as MobileLiveCallController | null };
    const driver = new FakeDriver();
    function Probe(): ReactElement {
      const [viewedSessionId, setViewedSessionId] = useState<string | undefined>('s1');
      const live = useMobileLive({
        hostClient: host as unknown as HostClient,
        sessionId: viewedSessionId,
        createDriver: () => driver,
      });
      useEffect(() => {
        probe.current = live;
      });
      return (
        <>
          <button type="button" data-testid="start" onClick={() => void live.start()} />
          <button type="button" data-testid="to-s2" onClick={() => setViewedSessionId('s2')} />
          <button type="button" data-testid="to-s3" onClick={() => setViewedSessionId('s3')} />
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
      await Promise.resolve();
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="to-s2"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.rebinds).toEqual(['s2']);
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="to-s3"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      releaseS2();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.rebinds.at(-1)).toBe('s3');
    expect(probe.current?.call?.boundSessionId).toBe('s3');
    expect(probe.current?.error).toBeNull();
  });
});
