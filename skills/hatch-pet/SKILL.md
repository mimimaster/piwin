---
name: hatch-pet
description: Hatch Pet — package generator guidance for piwin
---

# hatch-pet

Create a Codex-compatible pet package for piwin.

## Package layout

```text
my-pet/
  pet.json
  spritesheet.webp   # or .png
```

## pet.json minimum

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "One specific sentence about the pet.",
  "spritesheetPath": "spritesheet.webp"
}
```

## Spritesheet convention

- Preferred Codex size: 1536×1872 (8×9 cells of 192×208)
- Rows map to states: idle, running, waiting, failed, waving, jumping, review
- Columns are animation frames

## Install into piwin

```bash
# Desktop: Pet panel → Install local
# or copy to:
# ~/.piwin/pets/<id>/
```

Optional: import existing Codex pets with Desktop → Pet → Import ~/.codex/pets (copy-only).

## Validation rules

- No executable fields (js/script/hooks)
- spritesheetPath must be relative inside the package
- id: alphanumeric with -/_

