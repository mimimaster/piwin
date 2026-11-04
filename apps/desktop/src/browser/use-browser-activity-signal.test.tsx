// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import {
  useBrowserActivitySignal,
  type BrowserActivitySignal,
} from './use-browser-activity-signal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('conversation browser activity', () => {
  it('remembers each conversation independently and clears activity on Host changes or drafts', () => {
    const listeners = new Set<(message: HostServerMessage) => void>();
    const host = {
      subscribe: (listener: (message: HostServerMessage) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as HostClient;
    const root = createRoot(document.createElement('div'));
    let current: BrowserActivitySignal | undefined;
    function Probe(props: { sessionId: string | null; hostId: string }): null {
      current = useBrowserActivitySignal(host, props.sessionId, props.hostId);
      return null;
    }
    const render = (sessionId: string | null, hostId = 'host-a') =>
      act(() => root.render(<Probe sessionId={sessionId} hostId={hostId} />));
    const emit = (message: HostServerMessage) =>
      act(() => {
        for (const listener of listeners) listener(message);
      });
    try {
      render('a');
      emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.example', ts: 0 });
      emit({ type: 'browser/state', sessionId: 'b', url: 'https://b.example', ts: 0 });
      emit({ type: 'browser/controller', sessionId: 'b', owner: 'agent', ts: 0 });
      expect(current).toMatchObject({ url: 'https://a.example', owner: 'idle' });
      render('b');
      expect(current).toMatchObject({ url: 'https://b.example', owner: 'agent' });
      render('a');
      expect(current).toMatchObject({ url: 'https://a.example', owner: 'idle' });
      render(null);
      expect(current?.url).toBe('');
      render('a', 'host-b');
      expect(current).toMatchObject({ url: '', owner: 'idle' });
      emit({ type: 'browser/state', url: 'https://legacy.example', ts: 0 });
      expect(current?.url).toBe('');
    } finally {
      act(() => root.unmount());
    }
    expect(listeners.size).toBe(0);
  });
});
