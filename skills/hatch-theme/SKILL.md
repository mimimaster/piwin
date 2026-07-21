---
name: hatch-theme
description: Hatch Theme — package generator guidance for piwin
---

# hatch-theme

Create a token-only theme package for piwin.

## Package layout

```text
my-theme/
  theme.json
```

## theme.json

Tokens only — no executable CSS/JS.

Required tokens: bg, panel, panel2, border, text, muted, accent, accent2, danger, ok, radius, font.

Optional `artifact` overrides map into `--piwin-artifact-*` CSS variables.

## Install

```bash
# Desktop Theme panel → Install local directory
# Stored under ~/.piwin/themes/<id>/
```

