---
name: hatch-theme
description: "Build a token-only piwin theme package (theme.json colors, radius, font). Use when the user wants to create, customize, or fix a piwin theme, skin, or color scheme (主题 / 配色)."
version: 3
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
