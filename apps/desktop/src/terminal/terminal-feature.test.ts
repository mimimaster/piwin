import { describe, expect, it } from 'vitest';
import { createPiSessionCapabilities } from '@piwin/contracts';
import {
  canOfferConversationCli,
  canOpenEmbeddedTui,
  defaultsToConversationCli,
  isNativeCliEligible,
  isPiEmbeddedTuiAgent,
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
