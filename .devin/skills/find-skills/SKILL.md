---
name: find-skills
description: List and describe available Devin skills in this project and global config.
allowed-tools:
  - read
  - find_file_by_name
---

List the Devin skills available for this project.

1. Search for `SKILL.md` files in these locations (in order):
   - `/Volumes/BigDisk/Projects/Projects/piwin/.devin/skills/`
   - `/Volumes/BigDisk/Projects/Projects/piwin/skills/`
   - `/Volumes/BigDisk/Projects/Projects/piwin/.agents/skills/`
   - `/Users/yorickjue/.config/devin/skills/`
   - `/Users/yorickjue/.codeium/windsurf/skills/`
2. For each skill found, read its `SKILL.md` and extract:
   - `name`
   - `description`
   - invocation (`/<name>`)
   - whether it has `subagent: true` or `model` override
3. Group by source (project `.devin/`, project `skills/`, global, etc.).
4. Present a concise table or list. If no skills are found, say so and suggest creating one with `/create-skills`.
