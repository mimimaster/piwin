# No Repo default space

| Field | Value |
|---|---|
| Status | Implemented in Desktop + Host |
| Date | 2026-09-09 |
| Amended | 2026-09-21 |

## Decision

**Conversations** is general chat. `{ kind: 'general' }`. Original rules:
limited tools, no project write surface. Do not reclassify those sessions.

**No Repo** is a built-in project folder for users who want agent file ops
without opening a real repository. Same session kind as any other project
folder: `{ kind: 'project', projectPath: ~/.piwin/workspace }`.

The directory is Host-owned (`ensureGeneralWorkspace`). It is always trusted.
`project/open` on that path does **not** register it in `projects.json`, so it
never appears as a removable recent project.

## Sidebar

- Code pane: No Repo folder at the top of Projects. Nested rows come from
  `projectSessionsByPath[generalWorkspacePath]`, five-at-a-time like other
  folders. `+` creates a project-scoped session against that path.
- Chat pane: Conversations lists `{ kind: 'general' }` only. Untouched.

Selecting No Repo opens the built-in project (cwd, file tree, agent tools).
Selecting Conversations `+` still `project/clear`s and creates a general chat.

## Continue in project…

No Repo in the destination picker targets the built-in project path, not
`{ kind: 'general' }`.
