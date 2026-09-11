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

Ingest of a local Pi working environment is **one-way**. The Host file is not
live-shared with `~/.pi/agent/auth.json` (no symlink, no runtime `authPath`
pointing at the CLI file). Missing oauth keys may be merged into the Host file
from the Pi CLI home only on the default product root (`~/.piwin`), after an
explicit Settings action. test-host / custom `PIWIN_ROOT` never reads or copies
production credentials. Host start still creates `{PIWIN_ROOT}/pi-agent` (0700)
so login works with an empty store.
