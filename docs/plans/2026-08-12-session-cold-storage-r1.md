# Session Cold Storage R1 — safe manual backup / offload / restore

Date: 2026-08-12

## Status

**Executable plan with locked product defaults.**  
Do **not** merge `feat/cold-storage-offload` as-is. Rebuild from current `main`
in closed vertical slices. The obsolete WIP branch is reference-only.

Related:

- Safe lifecycle archive (already on main):  
  `docs/plans/2026-08-12-safe-session-lifecycle-archive.md`
- Obsolete prototype branch: `feat/cold-storage-offload` (`d073c3d` WIP snapshot)
- Not in R1: `feat/session-lifecycle-archive` gzip design (superseded)

## Goal

Ship a **manual, crash-safe, fully reversible** cold-storage loop:

```text
create complete pack
  → publish + verify on Host-external directory
  → offload archived main session
  → keep discoverable stub in session index
  → block ordinary resume / body access
  → restore from pack
  → session is local and usable again
```

Non-negotiable:

> Prefer a smaller feature over any failure path that deletes the only copy of
> session data.

## Locked product defaults

These defaults are frozen for R1 implementation. Change only with a plan update.

| Decision | Default |
|---|---|
| Pack granularity | **One pack per session** |
| Media in destructive offload | **Always include full session media** |
| Non-payload session files (`plan.json`, walkthrough, exports, backups) | **Remain local; not deleted by offload** |
| Import when index stub is missing | **Recreate index record from validated manifest** |
| `packOutputDir` path semantics | **Always Host filesystem path** (not client-local when remote) |
| Permanent delete of offloaded stub | **Forbidden in R1** (no silent purge of discoverability) |
| External pack cleanup | **User / Drive / NAS owns it; Piwin never auto-deletes packs** |
| Desktop in R1 | **Yes, but only after Host/CLI loop is green** |
| Automatic schedule | **Out of R1** |
| `archiveFirst` | **Out of R1** — user archives first (lifecycle plan/apply) |
| `offload --from-pack` | **Out of R1** |
| Force replace local body | **Out of R1** |
| Multi-session weekly packs | **Out of R1** |
| Staging-only destructive offload | **Forbidden** |
| Persistent size cache | **Out of R1** (measure live) |

Relationship to lifecycle:

```text
user archives (manual or lifecycle apply)
        ↓
cold storage may offload
```

Cold storage does **not** auto-archive and does **not** own permanent deletion.

## Public state model

Stable product states only:

```ts
type SessionStorageState = 'local' | 'offloaded' | 'missing-pack';
```

- Missing `storage` on a record means **local** (legacy-compatible).
- Intermediate states (`packing`, `moving`, `restoring`) live only in a Host
  transaction journal under `~/.piwin/cold-storage/transactions/`, never as the
  sole authority in `index.json`.

Suggested index field:

```ts
type SessionStorageInfo = {
  state: SessionStorageState;
  packId?: string;
  packPath?: string;
  packArchiveSha256?: string;
  transcriptSha256?: string;
  mediaTreeSha256?: string;
  offloadedAt?: string;
  offloadedBytes?: number;
  coldPreview?: string;
};
```

Project into `SessionSummary`, list pages, search hits, and remote summaries.

## R1 config surface

```ts
type SessionColdStorageConfig = {
  enabled: boolean;
  /** Host-absolute external publish directory; never under piwinRoot. */
  packOutputDir?: string;
  /** Status / planner only; never auto-executes. */
  localBudgetBytes?: number;
  /** Planner only selects main archived sessions older than this. */
  minArchivedAgeDays: number;
};
```

Safe defaults:

```ts
{ enabled: false, minArchivedAgeDays: 30 }
```

Hard rules (not configurable in R1):

- main sessions only
- archived only
- unpinned only
- non-live / not Store-leased only
- media always included for destructive offload
- explicit plan + confirm required

## Pack format

One session per archive. Host generates pack ids, for example:

```text
ses_<id>-20260812T103000Z-<random>.piwin-pack
```

Users never supply free-form pack ids that become filesystem path segments.

Layout:

```text
piwin-pack/
  manifest.json
  transcript/transcript.sqlite3
  media/**            # omitted only when the session has no media tree
```

Sibling sidecar:

```text
<pack>.piwin-pack.sha256
```

Manifest must be schema-validated and must include enough metadata to recreate
an index stub after cross-machine import.

### Payload definition

Recoverable payload for R1 offload:

```text
transcript.sqlite3
media/<sessionId>/**
```

Offload **must not** recursively delete `sessions/<sessionId>/`.  
Only verified payload paths may move into quarantine and later be removed.

### Archive implementation

- Define `SessionPackArchiveAdapter`
- Production adapter uses a maintained Node streaming zip library (no shell
  `zip`/`unzip`)
- Stream hashing; never `readFile` whole multi-GB packs
- Reject symlink / device entries, zip-slip, duplicate entries, path traversal,
  `.` / `..` ids, and oversized manifests

## Plan + confirm protocol

Do not use a bypassable `dryRun` flag as the safety gate.

```text
session/cold-storage-plan
  → planId + confirmationDigest + expiresAt + exact targets
user confirms
session/cold-storage-execute { planId, confirmationDigest }
```

Host must re-validate on execute:

- plan not expired
- digest matches
- session still archived / main / unpinned / local / non-live
- current local transcript + media hashes still match the planned pack hashes

Plans live in Host memory with a short TTL (about 10 minutes). Process restart
invalidates plans. Never persist an executable “delete ticket”.

## Offload transaction

Per session, exclusive:

1. Validate eligibility
2. Acquire session storage lock + transcript maintenance lease
3. Drain/block Store leases; close Store; WAL checkpoint+truncate
4. Hash current transcript + media
5. Build pack in staging; fully verify
6. Atomically publish pack + sidecar to external `packOutputDir`
7. Re-read and re-verify published pack
8. Re-hash local payload; refuse if stale vs pack
9. Journal `published`
10. Rename local payload into transaction quarantine
11. Journal `payload-moved`
12. Atomically update index → `offloaded` stub
13. Journal `indexed`
14. Delete quarantine; journal `committed`; release locks

Crash recovery rules:

| Failure point | Recovery |
|---|---|
| Before publish | local unchanged; clean staging |
| Published, payload not moved | local remains authority; pack is a backup |
| Payload moved, index still local | startup restores quarantine → local |
| Index offloaded, quarantine remains | pack is authority; startup deletes quarantine |

Host startup only auto-heals **journaled** transactions. Unknown split-brain is
reported by reconcile/doctor, never auto-picked.

## Restore transaction

Allowed targets:

- `offloaded`
- `missing-pack` with user-supplied matching pack
- no index stub, but valid pack (recreate record)

Forbidden in R1:

- replace existing local body
- force import over live/local transcript

Flow:

1. Exclusive lock
2. Verify archive + sidecar + manifest + payload hashes
3. Extract to transaction temp
4. SQLite integrity_check + message count + session identity
5. Media tree hash
6. Atomic rename into place
7. Index → `local` (or create record from manifest)
8. Commit journal; leave external pack untouched

## Command guards

Central guard (not per-command ad hoc checks):

```ts
assertSessionBodyAvailable(record, operation)
```

When state is `offloaded` or `missing-pack`:

**Allowed:** list, search, rename, pin/unpin, archive metadata, cold status,
import, reconcile.

**Rejected:** resume, prompt, transcript page/window/messages, outline, export,
truncate, duplicate, fork, unarchive, ordinary delete, any path that opens or
creates `transcript.sqlite3`.

Stable errors:

```text
session-body-offloaded
session-pack-missing
session-storage-busy
session-storage-conflict
session-pack-stale
session-pack-invalid
```

Hard acceptance:

> Resume / read of an offloaded session must never create an empty
> `transcript.sqlite3`.

## Host authority and serialization

- One HostRuntime authority per piwin root
- CLI must **not** spawn a second HostRuntime against the same root for cold ops
- Route through HostClient / host-serve / host-server allowlist
- Cold mutations are `serialized` in the serve command lane
- HostRuntime also owns a per-session `SessionStorageCoordinator` lock
  (required because Desktop may call Runtime without the CLI dispatcher)

## Cloud-sync and operational constraints

- Treat Drive/iCloud/NAS packs as untrusted until pack **and** sidecar exist and
  hash-verify
- Partial sync files are not restorable and must never authorize offload
- Plan/status should report estimated peak disk (local + staging + publish +
  quarantine) and refuse execute when free space is insufficient
- Side-chats of an offloaded main remain visible but must not sync against a
  missing source body; surface needs-restore
- Attachment path rewrite on restore must keep rewritten paths inside
  `media/<sessionId>/` or fail the whole restore
- `piwin doctor` (or cold reconcile) must list residual transactions,
  quarantine, offloaded+unreadable pack, and dirty local/storage metadata

## PR sequence

Work from a **clean worktree** of current `main`. Do not use the dirty primary
checkout. Do not merge or bulk cherry-pick `feat/cold-storage-offload`.

### PR 0 — Persistence hardening (foundation)

Branch idea: `fix/session-persistence-atomic-writes`

- Shared atomic text/JSON write helper: temp file → `fsync` → `rename`
- Session index already uses temp+rename + inter-process lock; add durable
  `fsync` and stop treating corrupt JSON as an empty catalog
- Config save uses the same atomic durable write
- Focused tests for atomic replace and corrupt-index failure

### PR 1 — Non-destructive pack backup

Branch idea: `feat/session-pack-backup`

- Contracts + strict manifest parser
- Streaming archive adapter + hashing
- `session/pack-create|verify|list`
- CLI only; never mutates session payload
- Real adapter tests (not only mocks)

### PR 2 — Storage residency + body guards

Branch idea: `feat/session-storage-residency`

- `SessionStorageInfo` projections
- Central body-availability guard
- Transcript registry exclusive maintenance for storage ops
- Offloaded/missing-pack fixtures; no destructive execute yet

### PR 3 — Manual offload / restore / reconcile (Host + CLI)

Branch idea: `feat/session-cold-storage-manual`

- Config, plan/execute, journals, quarantine
- Startup journal recovery
- Host-server allowlist + command-lane classification
- CLI through single Host authority
- Full fault-injection matrix (publish fail, stale hash, crash mid-move, etc.)

### PR 4 — Desktop discovery + settings

Branch idea: `feat/desktop-cold-storage`

- Settings: enabled, Host output dir, budget, min age, status/plan/execute,
  pack list/import/reconcile
- No schedule / dry-run toggle / include-media toggle / force replace
- Session row badges + restore-first open path
- Execute only after saved config + Host plan digest confirmation

### PR 5 — ADR + user docs + release gate

Branch: `docs/session-cold-storage-r1`

- `docs/adr/0044-safe-session-cold-storage.md`
- User recovery docs (Host path semantics, missing pack, external retention):
  `docs/guides/session-cold-storage.md`
- `piwin doctor` reports residual journals and missing packs
- Full `pnpm check` + focused `pnpm test:cold-storage`

## Obsolete branch handling

| Source | Action |
|---|---|
| `feat/cold-storage-offload` contracts/UI sketches | reference only |
| shell `zip`/`unzip` path | discard |
| staging-only offload / `--from-pack` / force import | discard |
| weekly multi-session packs | defer |
| planner pure functions | selectively port after rewrite |
| `feat/session-lifecycle-archive` gzip | discard (superseded by safe lifecycle on main) |
| `codex/subagent-production` | unrelated; leave alone |

## Explicit non-goals / backlog

- R2: automatic cold plan after lifecycle archive
- R2/R3: weekly pack compaction
- R3: force replace / authority conflict UI
- R3: optional media-less packs
- R3: remote Host directory browser API
- R3: persistent size cache
- R3: coordinated permanent delete of index + local + external pack

## Definition of done (R1)

- User can create and verify a restorable pack without mutating the session
- Offload only uses a pack built from the **current** local payload and published
  to a validated external Host directory
- Any pack/publish/verify failure leaves local data untouched
- Crash during offload/restore is deterministically recoverable from journals
- Offloaded sessions never open into empty local transcripts
- List/search still discover stubs; missing-pack has an explicit restore path
- CLI and Desktop use one Host authority
- Typecheck, architecture check, package tests, and cold fault-injection pass
- No half-built schedule / force-replace / permanent-purge entry points

## Immediate next actions

1. Land PR 0 persistence hardening on a clean worktree ✅
2. Implement PR 1 non-destructive pack backup ✅
3. Implement PR 2 storage residency + body guards ✅ (`feat/session-storage-residency`)
4. Implement PR 3 manual offload / restore / reconcile ✅ (`feat/session-cold-storage-manual`)
5. Implement PR 4 Desktop discovery + settings ✅ (`feat/desktop-cold-storage`)
6. Implement PR 5 ADR + user docs + release gate ✅ (`docs/session-cold-storage-r1`)
7. Keep `feat/cold-storage-offload` frozen as reference-only
