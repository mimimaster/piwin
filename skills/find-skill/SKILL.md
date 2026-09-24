---
name: find-skill
description: "Find a skill, MCP server or extension for a task: first what is installed, then what can be installed from piwin's curated catalog. Use when the user asks which skills exist, what a skill does, whether something covers a task, or wants to add a capability (有哪些 skill / 帮我找个能…的技能 / 装个 MCP)."
version: 4
---

# Find Skill

## Goal
The user ends up with the right capability for their task: an installed one they can invoke now, or a curated one installed with their consent.

## Steps
1. **Installed first.** List skills from `~/.piwin/skills`, project `.pi/skills` and `skills.extraPaths` (prefer `piwin skill list` when available). If one fits, name it and how to invoke it (`/<skill-id>`), then stop.
2. **Then the curated catalog.** If nothing installed fits, or the user wants something new, call `capability_search` with keywords from the task (Chinese or English). It covers skills, MCP servers and Pi extensions with pinned versions.
3. **Recommend, do not install yet.** Present at most three matches: what each does, its kind, prerequisites (e.g. Node, uv, an account or API key) and the evidence level. Say plainly that extensions and MCP servers run with the user's Host permissions.
4. **Install on a clear yes.** Call `capability_install` with the chosen `entryId`. The user also approves a permission prompt.
5. **Tell the user when it works:** skills from the next message, extensions after this turn, MCP servers in new sessions. Offer the entry's example request as a first try.

## Done means
- An installed capability is named with how to use it, or the user declined.
- Nothing was installed without the user's explicit agreement.

## Stop when
- The catalog has no match: say so, and only suggest an outside source if the user asks; never install arbitrary URLs through this skill.
- An install fails: report the tool's error and the unmet prerequisite; do not retry blindly.

## Verify
- Listed installed skills exist on disk and match scanner roots.
- After an install, `capability_search` shows the entry as `installed: true`.
