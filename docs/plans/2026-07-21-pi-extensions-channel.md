# Plan — Pi Extensions Channel (Slice 1)

| Field | Value |
|-------|-------|
| Status | **Slice 1 + Slice 2 (Desktop panel) implemented 2026-07-21** |
| Date | 2026-07-21 |
| Goal | Map `~/.piwin/extensions` into Pi `DefaultResourceLoader` so product shell can list/enable Pi Extensions without forking Pi |
| ADR | [`docs/adr/0010-pi-extensions-channel.md`](../adr/0010-pi-extensions-channel.md) |
| Backlog | D-EXT-01 done; D-EXT-02.. follow-on |

---

## 0. Why this first

Pi Extensions are the highest-leverage unused Pi surface. Skills/MCP already load; extensions did not.

Pi provides `DefaultResourceLoader({ additionalExtensionPaths, extensionsOverride })`.
piwin must not invent a second plugin runtime.

---

## 1. Slice 1 delivered

| Layer | Work |
|-------|------|
| contracts | `ExtensionSummary`, `ExtensionsConfig`, IPC list/set_enabled/ensure-bundled |
| agent-host | scan, ensure-bundled, ResourceLoader wire, host commands, config normalize |
| bundled | `path-guard.ts` blocks write/edit to secret-like basenames |
| CLI | `piwin extension list`, `ensure-bundled`, doctor line |
| tests | scanner + host-runtime + config-store |
| Desktop (Slice 2) | ExtensionsPanel list/toggle/ensure + security banner; rail + Settings |

## 2. Out of Slice 1 (follow-on)

- Pi Package / marketplace install for extensions
- Extension UI confirm bridge to Desktop permission modal
- Prompt-templates channel
- RPC mode extension parity

## 3. Acceptance

- [x] `config.extensions` round-trips
- [x] `extensions/list` returns bundled path-guard after ensure
- [x] `extensions/set_enabled` persists disabledIds
- [x] SDK ResourceLoader receives `additionalExtensionPaths`
- [x] unit tests green; host + CLI typecheck green
- [x] ADR + plan docs
