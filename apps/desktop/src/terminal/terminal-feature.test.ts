import { describe, expect, it } from 'vitest';
import { createPiSessionCapabilities } from '@piwin/contracts';
import {
  canOfferConversationCli,
  canOpenEmbeddedTui,
  defaultsToConversationCli,
  isNativeCliEligible,
  isPiEmbeddedTuiAgent,
  resolveConversationCliRoute,
} from './terminal-feature';

describe('embedded TUI availability', () => {
  it('offers the TUI on Desktop attached to its local or remote Host', () => {
    const local = { nativePtyAvailable: true, transport: 'live' } as const;
    expect(canOpenEmbeddedTui(local)).toBe(true);
    expect(canOpenEmbeddedTui({ ...local, nativePtyAvailable: false })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, transport: 'remote', remoteTargetAvailable: true })).toBe(true);
    expect(canOpenEmbeddedTui({ ...local, transport: 'remote' })).toBe(false);
    expect(canOpenEmbeddedTui({ ...local, transport: 'mock' })).toBe(false);
  });
});

describe('native CLI eligibility', () => {
  const transport = { nativePtyAvailable: true, transport: 'live' } as const;
  const ready = {
    agentId: 'claude-code',
    state: 'ready' as const,
    binaryPath: '/fake/claude',
    version: '1',
    supportStatus: 'verified' as const,
    checkedAt: '2026-10-03T00:00:00Z',
    nativeCli: { supported: true as const },
  };

  it('never treats Pi as a native-CLI backend', () => {
    expect(isPiEmbeddedTuiAgent('pi')).toBe(true);
    expect(isNativeCliEligible({
      agentId: 'pi',
      capabilities: { ...createPiSessionCapabilities(), nativeCli: { supported: true } },
    })).toBe(false);
    expect(canOfferConversationCli({ ...transport, agentId: 'pi' })).toBe(true);
  });

  it('requires Host-advertised nativeCli for external backends', () => {
    expect(isNativeCliEligible({ agentId: 'codex' })).toBe(false);
    expect(canOfferConversationCli({ ...transport, agentId: 'codex' })).toBe(false);
    expect(isNativeCliEligible({
      agentId: 'codex',
      capabilities: { ...createPiSessionCapabilities(), agentId: 'codex', nativeCli: { supported: true } },
    })).toBe(true);
    expect(isNativeCliEligible({ agentId: 'claude-code', agentStatus: ready })).toBe(true);
    expect(isNativeCliEligible({
      agentId: 'claude-code',
      capabilities: { ...createPiSessionCapabilities(), agentId: 'claude-code', nativeCli: { supported: false, reason: 'no TUI' } },
      agentStatus: ready,
    })).toBe(false);
  });

  it('still requires an embedded TUI transport even when Host advertises native CLI', () => {
    expect(canOfferConversationCli({
      ...transport,
      transport: 'mock',
      agentId: 'claude-code',
      agentStatus: ready,
    })).toBe(false);
  });

  it('keeps Grok eligible when legacy adapters omit nativeCli', () => {
    expect(isNativeCliEligible({ agentId: 'grok' })).toBe(true);
    expect(canOfferConversationCli({ ...transport, agentId: 'grok' })).toBe(true);
    expect(isNativeCliEligible({
      agentId: 'grok',
      agentStatus: {
        agentId: 'grok',
        state: 'not-installed',
        searched: ['/usr/bin'],
        checkedAt: '2026-10-03T00:00:00Z',
      },
    })).toBe(false);
  });
});

describe('conversation CLI default', () => {
  it('defaults only Grok sessions to the CLI shell', () => {
    expect(defaultsToConversationCli('grok')).toBe(true);
    for (const agentId of ['pi', 'claude-code', 'codex', 'mystery']) {
      expect(defaultsToConversationCli(agentId)).toBe(false);
    }
  });
});

describe('conversation CLI route', () => {
  const desktop = { nativePtyAvailable: true, transport: 'live' as const };
  const phone = { nativePtyAvailable: false, transport: 'remote' as const };

  it('keeps Desktop on its own terminal for Pi and on the Host for native agents', () => {
    expect(resolveConversationCliRoute({ ...desktop, agentId: 'pi' })).toBe('desktop-pty');
    expect(resolveConversationCliRoute({ ...desktop, agentId: 'grok' })).toBe('host-pty');
    // A Host that can run the TUI does not move Desktop off its own terminal.
    expect(resolveConversationCliRoute({ ...desktop, agentId: 'pi', hostRunsTui: true })).toBe('desktop-pty');
  });

  it('streams terminals from the Host on a phone', () => {
    expect(resolveConversationCliRoute({ ...phone, agentId: 'grok' })).toBe('host-pty');
    expect(resolveConversationCliRoute({ ...phone, agentId: 'pi', hostRunsTui: true })).toBe('host-pty');
  });

  it('offers nothing for Pi on a phone when the Host cannot run the TUI', () => {
    expect(resolveConversationCliRoute({ ...phone, agentId: 'pi' })).toBeNull();
    expect(canOfferConversationCli({ ...phone, agentId: 'pi', hostRunsTui: false })).toBe(false);
  });

  it('needs a Host connection when there is no terminal of its own', () => {
    expect(resolveConversationCliRoute({ nativePtyAvailable: false, transport: 'mock', agentId: 'grok', hostRunsTui: true })).toBeNull();
    expect(resolveConversationCliRoute({ nativePtyAvailable: false, transport: 'mock', agentId: 'pi', hostRunsTui: true })).toBeNull();
  });

  it('keeps native agents that the Host refuses off every route', () => {
    expect(resolveConversationCliRoute({
      ...phone,
      agentId: 'claude-code',
      capabilities: { ...createPiSessionCapabilities(), agentId: 'claude-code', nativeCli: { supported: false, reason: 'off' } },
    })).toBeNull();
  });
});

describe('conversation CLI default on touch screens', () => {
  it('opens Grok in the conversation view on a touch-first screen', () => {
    expect(defaultsToConversationCli('grok', { touchFirst: true })).toBe(false);
    expect(defaultsToConversationCli('grok', { touchFirst: false })).toBe(true);
  });
});
