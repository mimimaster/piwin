---
name: find-skill
description: "List the agent skills installed on this machine with names, descriptions, and paths. Use when the user asks which skills exist, what a skill does, or whether a skill covers some task (有哪些 skill)."
version: 3
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
