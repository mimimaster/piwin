# ADR 0075: Operator phone pairing for attached Host

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-09-25 |
| Related | [0036-host-server-multi-client-deployment.md](./0036-host-server-multi-client-deployment.md), [0037-mobile-remote-shell.md](./0037-mobile-remote-shell.md), [0076-bundled-phone-access-lan.md](./0076-bundled-phone-access-lan.md) |

## Context

piwin supports connecting thin desktop shells and mobile devices to a Host server (local sidecar or remote machine).

Previously, mobile access was managed exclusively through local sidecar IPC (`mobile-access/*` commands in `apps/desktop` and `apps/cli/src/mobile-access-serve.ts`), controlling a local WebSocket listener bound to `127.0.0.1:8787` (since ADR 0076: `0.0.0.0`, default port 8790, on by default).

When Desktop runs in thin-shell mode (`VITE_PIWIN_SHELL_ONLY=1`) or attaches to a remote Host (`transport === 'remote'`), `sidecarAvailable` is false. The Desktop settings page displayed "薄壳模式不可用" (Not available in shell-only mode) and blocked mobile access entirely.

However, a Host server operates with device pairing enabled by default (unless disabled via `PIWIN_HOST_PAIRING=0`). Operators attached to that Host—whether via thin shell, remote desktop, or CLI—need to inspect pairing status, toggle pairing on/off dynamically, mint pairing codes, list paired devices, and revoke devices directly on the Host without needing a local sidecar.

## Decision

### 1. First-class HostCommands for Host pairing

Add operator-facing HostCommands in `@piwin/contracts`:

- `host/pairing-status`: reports whether pairing is enabled on the Host, whether the caller can manage pairing, active paired device count, and the advertised WebSocket endpoint.
- `host/pairing-create-code`: mints an ephemeral pairing code pointing to the Host's advertised endpoint (with optional advertisedEndpoint override).
- `host/pairing-list-devices`: lists active paired devices.
- `host/pairing-revoke-device`: revokes a paired device and disconnects active connections.
- `host/pairing-set-enabled`: allows operators to dynamically enable or disable pairing without restarting the Host.

These commands belong to `HostCommand` and are part of the wire protocol. Pairing is enabled by default on the Host; operators can also toggle it at runtime.

### 2. HostServer owns pairing dispatch

`HostServer` in `@piwin/host-server` intercepts `isHostPairingCommandType(command.type)` before passing commands to `HostRuntime`. Pairing state is owned by `HostDevicePairing` and `HostDevicePairingFileStore` at the server level, keeping `HostRuntime` free of connection authentication concerns.

Shared pairing operations (`mintPairingCode`, `listPairedDevices`, `revokePairedDevice`, `countActivePairedDevices`) live in `packages/host-server/src/pairing-operations.ts`.

### 3. Role-based authorization

Only operator connections (`connection.deviceId === undefined`, i.e. authenticated via token or local loopback) can manage pairing (`canManage: true`). A paired phone connection (`connection.deviceId !== undefined`) may read status but is strictly forbidden from minting pairing codes, revoking devices, or toggling pairing state.

### 4. Desktop UI adaptation

In `apps/desktop`:
- Extract shared UI elements (`PairingCredentialCard` with a scannable `QrCode`, `PairedDeviceList`) into `apps/desktop/src/mobile-access-pairing-views.tsx`.
- `MobileAccessSettings` picks a panel:
  - Local sidecar (`transport === 'live'`): `mobile-access-local-panel.tsx` (ADR 0076).
  - Thin-shell or remote attach: `mobile-access-remote-panel.tsx`:
    - Provide a Switch to allow operators to turn mobile pairing on or off directly on the connected Host.
    - When enabled, automatically generate and display the pairing QR code and credentials on load so users can scan directly.
    - If the Host currently has pairing disabled, allow operators to flip the switch to enable it immediately without restarting or editing environment variables.
    - If the Host advertises a loopback address, warn that a phone cannot reach it.
    - If connected to an older Host that rejects or does not support `host/pairing-*`, gracefully display that the Host does not support remote pairing management.
