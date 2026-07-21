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
