# ADR 0075: Operator phone pairing for attached Host

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-09-25 |
| Related | [0036-host-server-multi-client-deployment.md](./0036-host-server-multi-client-deployment.md), [0037-mobile-remote-shell.md](./0037-mobile-remote-shell.md) |

## Context

piwin supports connecting thin desktop shells and mobile devices to a Host server (local sidecar or remote machine).

Previously, mobile access was managed exclusively through local sidecar IPC (`mobile-access/*` commands in `apps/desktop` and `apps/cli/src/mobile-access-serve.ts`), controlling a local WebSocket listener bound to `127.0.0.1:8787`.

When Desktop runs in thin-shell mode (`VITE_PIWIN_SHELL_ONLY=1`) or attaches to a remote Host (`transport === 'remote'`), `sidecarAvailable` is false. The Desktop settings page displayed "薄壳模式不可用" (Not available in shell-only mode) and blocked mobile access entirely.

However, a Host server itself can be started with device pairing enabled (e.g. `PIWIN_HOST_PAIRING=1`). Operators attached to that Host—whether via thin shell, remote desktop, or CLI—need to inspect pairing status, mint pairing codes, list paired devices, and revoke devices directly on the Host without needing a local sidecar.

## Decision

### 1. First-class HostCommands for Host pairing

Add operator-facing HostCommands in `@piwin/contracts`:

- `host/pairing-status`: reports whether pairing is enabled on the Host, whether the caller can manage pairing, active paired device count, and the advertised WebSocket endpoint.
- `host/pairing-create-code`: mints an ephemeral pairing code pointing to the Host's advertised endpoint.
- `host/pairing-list-devices`: lists active paired devices.
- `host/pairing-revoke-device`: revokes a paired device and disconnects active connections.

These commands belong to `HostCommand` and are part of the wire protocol. They never start or stop a listener; the Host's pairing capability is governed by its startup configuration.

### 2. HostServer owns pairing dispatch

`HostServer` in `@piwin/host-server` intercepts `isHostPairingCommandType(command.type)` before passing commands to `HostRuntime`. Pairing state is owned by `HostDevicePairing` and `HostDevicePairingFileStore` at the server level, keeping `HostRuntime` free of connection authentication concerns.

Shared pairing operations (`mintPairingCode`, `listPairedDevices`, `revokePairedDevice`, `countActivePairedDevices`) live in `packages/host-server/src/pairing-operations.ts`.

### 3. Role-based authorization

Only operator connections (`connection.deviceId === undefined`, i.e. authenticated via token or local loopback) can manage pairing (`canManage: true`). A paired phone connection (`connection.deviceId !== undefined`) may read status but is strictly forbidden from minting pairing codes or revoking devices.

### 4. Desktop UI adaptation

In `apps/desktop`:
- Extract shared UI elements (`PairingCredentialCard`, `PairedDeviceList`) into `apps/desktop/src/mobile-access-pairing-views.tsx`.
- In `MobileAccessSettings`:
  - If a local sidecar is available (`sidecarAvailable === true`), continue providing local sidecar listener controls.
  - If running in thin-shell or remote mode (`!sidecarAvailable`):
    - Query `host/pairing-status` from the attached Host.
    - If the Host has pairing enabled: allow operators to generate pairing codes and view/revoke devices directly on the Host.
    - If the Host has pairing disabled: display clear guidance to launch the Host with `PIWIN_HOST_PAIRING=1`.
    - If connected to an older Host that rejects or does not support `host/pairing-*`, gracefully display that the Host does not support remote pairing management.
