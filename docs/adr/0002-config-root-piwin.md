# ADR 0002: Config root `~/.piwin`

## Status

Accepted (2026-07-19)

## Context

Pi uses `~/.pi/agent/`. Binding product state only there couples upgrades and confuses ownership.

## Decision

Product root is **`~/.piwin`**. Map/overlay Pi resources (sessions, skills, extensions) instead of forking Pi home.

## Consequences

- Clear product ownership for media/themes/pets/mcp/index
- Must implement mapping layer for Pi sessions/skills
- Document dual-location mental model for advanced users

## Amendment (2026-09-11)

Subscription OAuth (`auth.json`) is Host-owned under `{PIWIN_ROOT}/pi-agent/`.
Login/logout still uses Pi `ModelRuntime`; the file is no longer `~/.pi/agent/auth.json`.
Pi-native skills/extensions/SYSTEM.md stay at `~/.pi/agent`.
A one-time copy from the legacy Pi path runs only for the default `~/.piwin` root
so test-host (`~/.piwin-test`) does not inherit production credentials.
