# ADR 0010: Pi Extensions channel under `~/.piwin`

## Status

Accepted (2026-07-21) · Slice 1 implemented

## Context

Pi coding-agent exposes TypeScript **Extensions** that can intercept `tool_call`,
register tools/commands, and customize compaction. Discovery is built into
`DefaultResourceLoader` via default agentDir paths, project `.pi/extensions`,
`additionalExtensionPaths`, and `extensionsOverride`.

piwin already maps Skills through `additionalSkillPaths` (ADR 0008). Extensions
were unused, so product features that belong in Pi were missing or reimplemented
as host tools.

## Decision

1. **Product directory:** `~/.piwin/extensions/` holds user/bundled extension
   modules (`*.ts` or `*/index.ts`), same layout Pi documents for
   `~/.pi/agent/extensions`.
2. **Host wiring (SDK):** `createPiResourceLoader` passes:
   - `additionalExtensionPaths` for enabled piwin/project/mapped entries
   - `extensionsOverride` to drop `config.extensions.disabledIds`
3. **No second runtime:** piwin scans filesystem metadata for list/enable UI;
   **only Pi loads/executes** extensions at session create.
4. **Bundled seed:** ship `path-guard` that hard-blocks write/edit targeting
   secret-like basenames (`.env`, `*.pem`, etc.). Disable via
   `config.extensions.disabledIds`.
5. **RPC:** stock Pi RPC path does not gain a separate extension injection API
   in Slice 1; SDK remains the capability-rich mode (ADR 0008 honesty).
6. **Boundary:** apps must not import `@earendil-works/pi-*`. Extension modules
   are loaded only by Pi jiti.

## Consequences

- Host/CLI can list and toggle extensions without executing them.
- Third-party extensions remain full-privilege once enabled (document in UI/doctor).
- Desktop panel and Pi Package install are follow-ons.
- Future: map prompt-templates/themes with the same ResourceLoader pattern.

## Alternatives considered

| Option | Why rejected |
|--------|--------------|
| Only use `~/.pi/agent/extensions` | breaks single config root product rule |
| Host reimplements tool_call gates only | duplicates Pi; misses community extensions |
| New `@piwin/extensions` package in Slice 1 | premature; scanner fits agent-host |
