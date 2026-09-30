import { describe, expect, it } from 'vitest';
import { createPiSessionCapabilities, type SessionBackendCapabilities } from '@piwin/contracts';
import { createSessionCapabilityGate } from './use-session-capabilities';

function grokCapabilities(): SessionBackendCapabilities {
  const capabilities = createPiSessionCapabilities();
  capabilities.agentId = 'grok';
  capabilities.operations.fork = {
    supported: false,
    reason: 'Forking Grok sessions is not available yet',
  };
  capabilities.operations.images = {
    supported: false,
    reason: 'Grok does not accept images yet',
  };
  return capabilities;
}

describe('createSessionCapabilityGate', () => {
  it('treats a session with no reported capabilities as fully supported', () => {
    const gate = createSessionCapabilityGate(undefined);
    expect(gate.supports('fork')).toBe(true);
    expect(gate.supports('images')).toBe(true);
    expect(gate.unsupportedReason('fork')).toBeUndefined();
    expect(gate.isExternalBackend).toBe(false);
  });

  it('treats an explicit Pi capability record as fully supported and not external', () => {
    const gate = createSessionCapabilityGate(createPiSessionCapabilities());
    expect(gate.supports('fork')).toBe(true);
    expect(gate.isExternalBackend).toBe(false);
  });

  it('gates exactly the operations the backend marked unsupported', () => {
    const gate = createSessionCapabilityGate(grokCapabilities());
    expect(gate.supports('fork')).toBe(false);
    expect(gate.supports('images')).toBe(false);
    expect(gate.unsupportedReason('fork')).toBe('Forking Grok sessions is not available yet');
    // Operations the agent keeps working are untouched.
    expect(gate.supports('prompt')).toBe(true);
    expect(gate.supports('rename')).toBe(true);
    expect(gate.isExternalBackend).toBe(true);
  });
});
