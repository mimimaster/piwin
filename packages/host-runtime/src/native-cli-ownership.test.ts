import { describe, expect, it, vi } from 'vitest';
import { AgentCliOwnershipController } from './native-cli-ownership.js';

describe('AgentCliOwnershipController', () => {
  it('closes the Desktop/native writer race in both directions', () => {
    const changes: string[] = [];
    const ownership = new AgentCliOwnershipController({
      onChange: (state) => changes.push(state.kind),
    });

    expect(ownership.tryBeginNative('s1', true)).toBe('writer-busy');
    expect(ownership.get('s1').kind).toBe('desktop');

    expect(ownership.tryBeginNative('s1', false)).toBeUndefined();
    expect(ownership.get('s1')).toEqual({ kind: 'switching', sessionId: 's1', target: 'native' });
    expect(ownership.isDesktopWriterBlocked('s1')).toBe(true);

    // Concurrent second open while switching is busy.
    expect(ownership.tryBeginNative('s1', false)).toBe('writer-busy');

    ownership.confirmNative('s1', 'pty-1');
    expect(ownership.get('s1')).toEqual({ kind: 'native', sessionId: 's1', ptyId: 'pty-1' });

    expect(ownership.tryBeginDesktop('s1')).toBeUndefined();
    expect(ownership.get('s1')).toMatchObject({ kind: 'switching', target: 'desktop', ptyId: 'pty-1' });
    ownership.confirmDesktop('s1');
    expect(ownership.get('s1').kind).toBe('desktop');
    expect(ownership.isDesktopWriterBlocked('s1')).toBe(false);
    expect(changes).toEqual(['switching', 'native', 'switching', 'desktop']);
  });

  it('aborts an unconfirmed native open and retains recovery after unexpected exit', () => {
    const ownership = new AgentCliOwnershipController();
    ownership.tryBeginNative('s1', false);
    ownership.abortNativeOpen('s1');
    expect(ownership.get('s1').kind).toBe('desktop');

    ownership.tryBeginNative('s1', false);
    ownership.confirmNative('s1', 'pty-1');
    ownership.markRecovery('s1', 'pty-1');
    expect(ownership.get('s1')).toMatchObject({ kind: 'switching', target: 'desktop', ptyId: 'pty-1' });
    expect(ownership.isDesktopWriterBlocked('s1')).toBe(true);
  });

  it('allows two independent sessions to open native writers', () => {
    const ownership = new AgentCliOwnershipController();
    expect(ownership.tryBeginNative('a', false)).toBeUndefined();
    expect(ownership.tryBeginNative('b', false)).toBeUndefined();
    ownership.confirmNative('a', 'pty-a');
    ownership.confirmNative('b', 'pty-b');
    expect(ownership.get('a').kind).toBe('native');
    expect(ownership.get('b').kind).toBe('native');
  });
});
