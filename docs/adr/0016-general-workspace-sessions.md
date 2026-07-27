# ADR 0016: General Workspace Sessions

## Status

Proposed (2026-07-25)

## Context

piwin is a general-purpose agent shell. Today every session requires an explicit
project path at creation time. The Desktop UI shows no composer area and
prevents sending a prompt until the user selects or opens a trusted project.

This creates an unnecessary barrier for common agent tasks that do not need
project-level context:

- Asking general knowledge questions
- Composing text, code snippets, or analysis not tied to a specific repo
- Testing a model or provider configuration
- Exploring piwin capabilities before opening a project

Existing coding-agent products (ChatGPT, Claude.ai, Gemini) accept text
immediately after launch without a workspace prerequisite. piwin's project
requirement makes it feel broken or incomplete for the first interaction.

Allowing sessions without a project must not bypass security boundaries:
destructive bash, secret-file writes, network access, Git mutations, MCP server
invocations, and path-traversal checks remain host-enforced regardless of scope.

## Decision

Introduce a **SessionScope** discriminated union. Every session has one of two
mutually exclusive scopes:

### Session scope model

```
SessionScope =
  | { kind: "general" }
  | { kind: "project"; projectPath: string }
```

- **General scope**: The host working directory is a product-owned path at
  `~/.piwin/workspace/`. Project rules, instructions, remembered permissions,
  skills, prompts, and extensions from any user project are never loaded.
  Project-only tools (Git, file tree, directory listing, Tauri PTY, project
  permission management) are unavailable and return actionable errors.

- **Project scope**: The host working directory is the canonical trusted project
  root. Full current product rules apply, including project-local instructions,
  remembered permissions, Skills discovery, Git, file tree, and Tauri PTY.
  Project trust must be established (`project/open` + `project/trust`) before
  session creation or prompt submission.

### General safety invariants

1. General sessions retain normal host-owned permission enforcement for bash,
   secret-file writes, destructive Git, network fetch/search, and MCP calls.
2. A General session may write under its own workspace through normal
   approved tools, but must not silently gain project-trusted access to
   another folder on the filesystem.
3. General sessions have **no project remembered permissions**. Permission
   resolution at the UI/CLI level offers `Allow once` and `Deny`; it must not
   offer `Allow for project`.
4. General resource loading includes bundled tools and user-level MCP
   configuration, but skips project-local AGENTS.md, rules, skills, prompts,
   extensions, and project MCP overlay configurations.
5. Project-only host commands (git/*, project/*, pty/open without a scope
   project path) reject with an actionable error when the caller has no
   project scope. The Desktop UI correspondingly disables or hides those
   panels during General scope.

### Persistence

The product session-index schema graduates from v1 to v2. V2 records carry an
explicit `scope` and `workingDirectory` alongside the legacy `projectPath`
field for backward compatibility.

- On load, a v1 document normalizes every record to v2 by setting
  `{ scope: { kind: 'project', projectPath: record.projectPath },
     workingDirectory: record.projectPath }`.
- The first mutation writes the full document as v2. Reads alone do not
  rewrite.
- Transcript documents gain `scope` and `workingDirectory` fields. Old
  transcripts infer project scope from their legacy `projectPath` field on
  load.
- Old project session IDs, transcripts, and message data are never moved or
  regenerated.

### Host and transport contracts

- `CreateSessionInput.projectPath` is replaced by `CreateSessionInput.scope:
  SessionScope`. Backward compatibility adapters convert a bare
  `projectPath` into `{ kind: 'project', projectPath }` where practical.
- `AgentHost.listSessions(projectPath: string)` gains an overload that accepts
  a `SessionScope` for scope-based listing.
- `SessionSummary` and `SessionIndexRecord` carry `scope` and
  `workingDirectory`. `projectPath` remains set for project-scoped records
  and is absent/undefined for general-scoped records.
- `session/list` IPC command accepts `SessionScope` or a `projectPath` field.
  The host resolves scope-based vs. project-based queries internally.

### Navigation

Navigator layout becomes:

```
General
  [New session]
  general session history

Projects
  project A → its session history
  project B → its session history
```

- Desktop startup selects General scope by default and hydrates its session
  list.
- Opening a project switches to project scope. General history is preserved
  and restored on return.
- A project session cannot be reassigned to general scope, and vice versa.
- The scope is purely navigational/metadata; no session data is moved or
  converted between scopes.

## Consequences

- First-run Desktop shows a composer immediately. No picker or trust modal
  required for general conversation.
- General sessions are a full product concept, not a UI hack or hidden mode.
  The CLI also supports them: `piwin chat "hello"` creates a general session
  by default; `piwin chat -p <path>` creates a project session.
- General sessions have a consistent, predictable working directory
  (`~/.piwin/workspace/`) owned by piwin itself, not the user's home.
- Security boundaries are unchanged for project work and strengthened for
  general use (no accidental project instruction leakage, no durable project
  permission grants).
- Desktop UI becomes more complex: it must maintain scope state and
  conditionally show/hide project-only panels.
- Session index migration requires one-time v1→v2 normalization. v2 records
  remain structurally backward-compatible with consumers that only read
  `projectPath`.
