import { describe, expect, it } from 'vitest';
import { shouldShowSidebarHostStatus } from './sidebar-host-status.js';

describe('shouldShowSidebarHostStatus', () => {
  it('hides the bundled sidecar chip (一体包 / tauri dev)', () => {
    expect(shouldShowSidebarHostStatus('live')).toBe(false);
  });

  it('shows mock and remote, which are operator-facing Host identities', () => {
    expect(shouldShowSidebarHostStatus('mock')).toBe(true);
    expect(shouldShowSidebarHostStatus('remote')).toBe(true);
  });

  it('does not treat a prettier local label as a reason to show', () => {
    expect(shouldShowSidebarHostStatus('本机 Host · 8787')).toBe(false);
  });
});
