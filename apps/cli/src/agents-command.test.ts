import { describe, expect, it } from 'vitest';
import type { ExternalAgentStatus } from '@piwin/contracts';
import { describeAgent, planAgentsSubcommand } from './agents-command.js';

function status(overrides: Partial<ExternalAgentStatus> & Pick<ExternalAgentStatus, 'state'>): ExternalAgentStatus {
  return {
    agentId: 'grok',
    checkedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  } as ExternalAgentStatus;
}

describe('planAgentsSubcommand', () => {
  it('installs the reviewed adapter through the same Host authority', () => {
    expect(planAgentsSubcommand('install')).toEqual({ kind: 'mutate-host', sub: 'install' });
  });

  it('routes inventory mutations to the Host rather than faking local toggles', () => {
    for (const sub of ['enable', 'disable', 'uninstall']) {
      expect(planAgentsSubcommand(sub)).toEqual({ kind: 'mutate-host', sub });
    }
  });

  it('reads cached state for list but re-probes for check and login', () => {
    expect(planAgentsSubcommand('list')).toEqual({ kind: 'query-host', refresh: false });
    expect(planAgentsSubcommand('check')).toEqual({ kind: 'query-host', refresh: true });
    expect(planAgentsSubcommand('login')).toEqual({ kind: 'query-host', refresh: true });
  });

  it('falls back to usage for anything else', () => {
    expect(planAgentsSubcommand('wat')).toEqual({ kind: 'usage' });
  });
});

describe('describeAgent', () => {
  it('reports a missing CLI with the searched paths', () => {
    const line = describeAgent(
      status({ state: 'not-installed', searched: ['/usr/local/bin', '/opt/homebrew/bin'] }),
    );
    expect(line).toContain('not installed');
    expect(line).toContain('/usr/local/bin');
  });

  it('reports a found-but-broken binary with its reason', () => {
    const line = describeAgent(
      status({ state: 'unavailable', binaryPath: '/usr/local/bin/grok', reason: 'handshake failed' }),
    );
    expect(line).toContain('unavailable');
    expect(line).toContain('handshake failed');
  });

  it('distinguishes installed-but-signed-out from ready', () => {
    const signedOut = describeAgent(
      status({
        state: 'unauthenticated',
        binaryPath: '/usr/local/bin/grok',
        version: '1.0.44',
        supportStatus: 'verified',
      }),
    );
    expect(signedOut).toContain('sign-in required');

    const ready = describeAgent(
      status({
        state: 'ready',
        binaryPath: '/usr/local/bin/grok',
        version: '1.0.44',
        supportStatus: 'verified',
      }),
    );
    expect(ready).toContain('ready');
    expect(ready).toContain('v1.0.44');
  });
});
