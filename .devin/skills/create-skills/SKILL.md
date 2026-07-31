---
name: create-skills
description: Scaffold a new Devin SKILL.md with correct frontmatter and piwin conventions.
allowed-tools:
  - read
  - write
  - find_file_by_name
---

Create a new Devin skill for this project.

1. Ask the user for:
   - skill name (kebab-case)
   - short description
   - what it should do (high-level workflow)
   - whether it should run as a subagent (`subagent: true`)
   - tools it needs (read, grep, exec, web_search, ask_user_question, write, etc.)
2. Validate the name is kebab-case and does not already exist in `.devin/skills/` or `skills/`.
3. Create the skill at `.devin/skills/<name>/SKILL.md` with:
   - Proper YAML frontmatter
   - `name`, `description`, `allowed-tools`
   - Optional `subagent: true` or `model` override
   - A concise, actionable prompt body following the project style
4. After writing, summarize what was created and how to invoke it with `/<name>`.

Default allowed-tools for new skills should be minimal. Prefer asking if a tool should include `Write` or `Exec`.
