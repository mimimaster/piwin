/**
 * Visible sidebar shelf host chip.
 *
 * `transport` is `HostClient.getTransport()` (`mock` | `live` | `remote`).
 * `live` is the bundled sidecar (一体包 and `tauri dev`) — not a user choice,
 * so the chip is chrome noise. `mock` and `remote` stay visible because they
 * tell the operator which Host they are talking to.
 *
 * Display labels are not consulted: a prettier local string must not bring
 * the chip back.
 */
export function shouldShowSidebarHostStatus(transport: string): boolean {
  return transport === 'mock' || transport === 'remote';
}
