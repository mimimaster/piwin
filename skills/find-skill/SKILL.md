---
name: find-skill
description: List agent skills available on this machine for the current session.
version: 2
---

# Find Skill

## Goal
An accurate list of skills the user can invoke, with enough description to pick one.

## Done means
- Skills discovered from `~/.piwin/skills`, project `.pi/skills`, and `skills.extraPaths`.
- Prefer `piwin skill list` when available.
- Output names + short descriptions (and path if helpful).

## Stop when
- Roots missing or empty — report that clearly.

## Verify
- Listed entries exist on disk and match scanner roots.
