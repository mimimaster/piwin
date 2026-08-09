---
name: hatch-theme
description: Hatch Theme — package generator guidance for piwin
version: 2
---

# hatch-theme

## Goal
A token-only theme package installable in piwin (Theme panel → Install local → `~/.piwin/themes/<id>/`).

## Done means
```text
my-theme/
  theme.json
```

`theme.json` is tokens only (no executable CSS/JS). Required: `bg`, `panel`, `panel2`, `border`, `text`, `muted`, `accent`, `accent2`, `danger`, `ok`, `radius`, `font`. Optional `artifact` map → `--piwin-artifact-*`.

## Stop when
- Theme needs runnable CSS/JS — reject; keep tokens only.

## Verify
- Install applies tokens; artifact overrides (if any) map to expected CSS variables.
