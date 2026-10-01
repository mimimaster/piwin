/**
 * Shared ExternalAgentStatus fixtures for Desktop tests (ADR 0082).
 * Lives with the other test fixtures so it is never mistaken for app code; a
 * contracts shape change still breaks one place.
 */
import type { ExternalAgentStatus } from '@piwin/contracts';

export function readyAgent(agentId = 'grok'): ExternalAgentStatus {
  return {
    agentId,
    state: 'ready',
    binaryPath: '/usr/local/bin/grok',
    version: '1.0.44',
    supportStatus: 'verified',
    checkedAt: '2026-09-30T00:00:00.000Z',
  };
}

export function notInstalledAgent(agentId = 'grok'): ExternalAgentStatus {
  return {
    agentId,
    state: 'not-installed',
    searched: ['/usr/local/bin', '/opt/homebrew/bin'],
    checkedAt: '2026-09-30T00:00:00.000Z',
  };
}
