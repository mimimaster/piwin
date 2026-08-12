# Safe session lifecycle archive

Date: 2026-08-12

## Goal

Provide an explicit, reviewable way to archive inactive product sessions without
reviving the obsolete `transcript.json` compression design or racing another
Host that owns the same session.

## Scope

This slice adds:

- `PiwinConfig.session.lifecycle.archive.maxInactiveDays`
- `PiwinConfig.session.lifecycle.archive.maxActiveMainSessions`
- deterministic `session/lifecycle-plan` previews
- explicit `session/lifecycle-apply` with a required plan id
- CLI commands:
  - `piwin session lifecycle plan`
  - `piwin session lifecycle apply --plan <plan-id>`
- safe manual archive/delete coordination across Host runtimes and SQLite Store
  command leases
- quarantine-first permanent deletion with rollback when the index mutation
  fails

This slice deliberately does not add:

- a background scheduler
- automatic permanent deletion or retention expiry
- gzip compression of session files
- a second transcript authority
- cold-storage pack creation or restore

Cold storage remains a separate capability described by
`docs/plans/2026-08-10-session-cold-storage-offload.md`.

## Selection policy

Only active main sessions are candidates. A record with no `kind` is treated as
a legacy main session. The planner always excludes:

- archived sessions
- pinned sessions
- subagent sessions
- side-chat sessions

`maxInactiveDays` selects sessions whose `updatedAt` is strictly older than the
threshold. `maxActiveMainSessions` keeps the newest N unpinned main sessions and
selects the remainder. If both rules select the same record, `inactive-age` is
the reported reason.

## Plan and apply protocol

A plan id hashes the normalized policy and the ordered candidate snapshot:

- session id
- `updatedAt`
- archive reason

Generation time and display name do not affect the id. Apply reloads config and
the session index and rejects a plan id that no longer matches. Each candidate
is checked again immediately before mutation; a session changed, pinned,
archived, missing, or no longer main is skipped.

Apply never aborts a busy session. Resident, activating, suspending, Run-owned,
permission-owned, Extension-UI-owned, replacement-owned, or Store-leased
sessions return `busy` and remain active.

## Cross-Host coordination

Each resident product session has a PID-backed lease under the product root.
Activation and lifecycle maintenance also share a per-session operation lock.
This prevents a one-shot CLI Host from archiving or activating a session owned
by an attached Desktop or another CLI Host.

Dead owners are removed only after the recorded PID is no longer alive. The
runtime lease is released after backend generation cleanup and SQLite Store
closure, not when the in-memory map is first cleared.

## Permanent delete transaction

Manual permanent delete remains separate from lifecycle apply. It requires an
archived session unless `force` is explicitly supplied.

The Host:

1. obtains session operation and transcript maintenance leases;
2. disposes the live runtime and closes the Store;
3. atomically moves session and media directories into a transaction directory
   under `trash/session-deletes`;
4. removes the session record and updates dependent side-chat source state in
   one index mutation;
5. restores quarantined directories if the index mutation fails;
6. removes the quarantine transaction after the index commit.

If final trash cleanup fails, deletion remains committed and the response
contains a cleanup warning; the quarantined body remains isolated for manual
recovery or later doctor cleanup.

## Persistence invariants

- Session ids used as filesystem path segments reject empty values, `.`, `..`,
  separators, and NUL bytes.
- Session index mutations use an inter-process PID-owned lock.
- Session index documents are written to a unique temporary file and atomically
  renamed into place.
- Archive, restore, and delete update dependent side-chat source state in the
  same locked index mutation.
- Transcript maintenance rejects new Store access and waits for existing
  command leases before destructive maintenance.

## Verification

Focused tests cover:

- inactivity boundaries, active count limits, pinned/main exclusions, and plan
  id determinism
- stale apply rejection and per-candidate skip reporting
- conditional archive freshness and protection checks
- side-chat state consistency
- path traversal rejection
- cross-Host runtime leases and operation locks
- transcript maintenance leases
- quarantine delete success and rollback
- CLI plan/apply command payloads and output

