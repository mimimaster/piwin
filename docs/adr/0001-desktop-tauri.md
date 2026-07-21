# ADR 0001: Desktop shell = Tauri 2

## Status

Accepted (2026-07-19)

## Context

piwin needs a native desktop Agent Window. Candidates: Electron, Tauri, pure web.

## Decision

Use **Tauri 2** for `apps/desktop`.

## Consequences

- Smaller footprint than Electron
- Rust side for OS integrations (FS, protocols, windowing)
- Web UI still TypeScript/React (or similar) in WebView
- Need careful design for Node-based Pi host: prefer **host sidecar** process, UI ↔ host IPC
