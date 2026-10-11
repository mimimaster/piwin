import { describe, expect, it, vi } from 'vitest';

vi.mock('@piwin/host-runtime', () => {
  throw new Error('Attached CLI loaded local Host-runtime');
});
vi.mock('@piwin/host-server', () => {
  throw new Error('Attached CLI loaded local Host-server');
});
vi.mock('../attach-existing-host.js', () => ({
  readCliHostAttachTarget: () => ({ endpoint: 'ws://test-host' }),
  connectCliAttachedHost: async () => ({ close: vi.fn(), request: vi.fn() }),
}));

describe('attached TUI startup', () => {
  it('connects without evaluating local Host implementations', async () => {
    const { openTuiHostLink } = await import('./tui-host-link.js');
    const link = await openTuiHostLink({ mock: true, onHostError: vi.fn() });
    expect(link.kind).toBe('attached');
    await link.dispose();
  });
});
