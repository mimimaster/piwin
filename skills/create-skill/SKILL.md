---
name: create-skill
description: "Create or revise an Agent Skill (SKILL.md) with valid frontmatter and a short outcome-oriented body. Use when the user asks to make, write, package, or improve a skill (做个 skill / 写个 skill), or wants a repeatable workflow saved for future sessions."
version: 3
---

# Create Skill

## Goal
A loadable skill at `~/.piwin/skills/<name>/SKILL.md` or `.pi/skills/<name>/SKILL.md` that strong models can follow without process theater.

## Done means
- Directory `skill-name/SKILL.md` with YAML frontmatter `name` + `description` (description states when to use it); optional `version` and `hidden`.
- Body uses: **Goal**, **Done means**, **Stop when**, **Constraints**, **Verify** (omit empty sections).
- States success criteria and stop conditions; names host tools only when required.
- No repeated rules, long example farms, style essays, or absolute wording except real safety/invariants.
- Result-oriented: ideal outcome first; let the model choose the path.

## Stop when
- Skill would only restate host-enforced policy — shrink or skip.

## Constraints
- Install path: user `~/.piwin/skills/<name>/` or project `.pi/skills/<name>/`.

## Verify
- Frontmatter parses; description is enough for skill discovery; body is short and checkable.
