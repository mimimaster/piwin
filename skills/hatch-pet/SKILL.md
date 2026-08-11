---
name: hatch-pet
description: Hatch Pet — package generator guidance for piwin
version: 2
---

# hatch-pet

## Goal
A Codex-compatible pet package installable in piwin (Desktop Pet panel or `~/.piwin/pets/<id>/`).

## Done means
Package layout:

```text
my-pet/
  pet.json
  spritesheet.webp   # or .png
```

`pet.json` minimum: `id`, `displayName`, `description`, `spritesheetPath` (relative inside package).

Spritesheet: prefer 1536×1872 (8×9 cells of 192×208); rows = idle, running, waiting, failed, waving, jumping, review; columns = frames.

## Stop when
- Package would need executable fields (js/script/hooks) — not allowed; redesign as data-only.

## Constraints
- `id`: alphanumeric plus `-`/`_`.
- Optional: import existing Codex pets via Desktop → Pet → Import. Scan `~/.codex/pets` to review and select one or more packages, or enter a concrete package directory for direct installation (copy-only).

## Verify
- Install/import succeeds; no executables; spritesheet path resolves inside the package.
