# ADR 0044: Safe manual session cold storage

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-13 |
| Related | ADR 0002, ADR 0009, ADR 0036, ADR 0040 |
| Execution plan | [`2026-08-12-session-cold-storage-r1.md`](../plans/2026-08-12-session-cold-storage-r1.md) |
| User guide | [`session-cold-storage.md`](../guides/session-cold-storage.md) |

## Context

Archived sessions keep their full transcript and media on the Host. Over time
that payload is the largest local cost, while the session still needs to remain
discoverable in list/search. Users also need a restorable backup they can keep
on a Drive, NAS, or other Host-visible volume.

Three authorities must stay separate:

| Authority | Meaning | Owner |
|-----------|---------|-------|
| Archive lifecycle | Hidden from the active list | Session index + lifecycle plan |
| Runtime residency (ADR 0040) | No live Pi/worker is allocated | Host Runtime |
| Storage residency (this ADR) | Where the transcript/media payload lives | Host + `@piwin/session` |

An earlier prototype (`feat/cold-storage-offload`) mixed schedule, force
replace, staging-only delete, and shell `zip`/`unzip`. That branch is
reference-only. R1 rebuilds a smaller, crash-safe, fully reversible loop.

The non-negotiable:

> Prefer a smaller feature over any failure path that deletes the only copy of
> session data.

## Decision

### 1. Storage state is orthogonal to archive and runtime

Public product states only:

```ts
type SessionStorageState = 'local' | 'offloaded' | 'missing-pack';
```

Missing `storage` on an index record means **local** (legacy-compatible).
Intermediate packing/moving/restoring lives only in Host journals under
`~/.piwin/cold-storage/transactions/`, never as the sole authority in
`index.json`.

`offloaded` and `missing-pack` keep a discoverable index stub. They never
authorize creating an empty `transcript.sqlite3`.

### 2. One complete pack per session

A pack is a streaming zip (`.piwin-pack`) plus a sibling `.sha256` sidecar.
Host generates pack ids. Users never supply free-form ids that become path
segments.

```text
piwin-pack/
  manifest.json
  transcript/transcript.sqlite3
  media/**            # omitted only when the session has no media tree
```

Destructive offload **always** includes full session media. Non-payload files
(`plan.json`, walkthrough, exports, backups) stay in
`~/.piwin/sessions/<id>/` and are not deleted.

`packOutputDir` is always a **Host filesystem path**, never a client-local path
when the shell is remote. It must be absolute and must not sit under the
piwin root.

### 3. Archive first; offload is manual plan + confirm

Cold storage does not auto-archive and does not own permanent deletion.
Eligibility is main + archived + unpinned + local + not live.

Safe config defaults:

```ts
{ enabled: false, minArchivedAgeDays: 30 }
```

`localBudgetBytes` is status/planner only. It never auto-executes.

The safety gate is not a bypassable `dryRun` flag:

```text
session/cold-storage-plan
  → planId + confirmationDigest + expiresAt + exact targets
session/cold-storage-execute { planId, confirmationDigest }
```

Plans live in Host memory (~10 minutes). Process restart invalidates them.
Never persist an executable delete ticket. Execute re-validates eligibility
and post-checkpoint transcript/media hashes.

### 4. Offload is a journaled transaction, not a recursive delete

Per session, exclusive (`SessionStorageCoordinator` + transcript maintenance
lease):

1. WAL checkpoint, then hash current transcript + media
2. Build and fully verify a pack in staging
3. Atomically publish pack + sidecar to `packOutputDir`
4. Re-read and re-verify the published pack
5. Re-hash local payload; refuse if stale versus the pack
6. Journal `published`, move only payload paths into quarantine
7. Atomically update the index to an `offloaded` stub
8. Delete quarantine; journal `committed`

Crash recovery is deterministic from the journal:

| Failure point | Recovery |
|---------------|----------|
| Before publish | local unchanged; clean staging |
| Published, payload not moved | local remains authority; pack is a backup |
| Payload moved, index still local | startup restores quarantine → local |
| Index offloaded, quarantine remains | pack is authority; startup deletes quarantine |

Host startup only auto-heals **journaled** transactions. Unknown split-brain is
reported by reconcile/doctor, never auto-picked.

### 5. Restore never replaces a local body

Allowed restore targets:

- `offloaded`
- `missing-pack` with a user-supplied matching pack
- no index stub, but a valid pack (recreate the index record from the
  validated manifest)

Forbidden in R1:

- replace an existing local body
- force import over a live/local transcript
- recreate an empty local transcript from the stub or manifest alone

Restore verifies archive + sidecar + manifest + payload hashes, extracts to a
transaction temp, runs SQLite integrity checks, then atomically renames into
place and marks the index `local`. The external pack is left untouched.

### 6. Body access is centrally gated

`assertSessionBodyAvailable` is the choke, not per-command ad hoc checks.
When state is `offloaded` or `missing-pack`:

**Allowed:** list, search, rename, pin/unpin, archive metadata, cold status,
import, reconcile.

**Rejected:** resume, prompt, transcript page/window/messages, outline, export,
truncate, duplicate, fork, unarchive, ordinary delete, pack-create, any path
that opens or creates `transcript.sqlite3`.

Desktop open is restore-first: selecting an offloaded stub never calls
`session/resume`.

### 7. One Host authority

CLI and Desktop talk to one HostRuntime. Cold mutations are `serialized` on
the serve command lane. Host-server allowlists the same commands. Desktop
never invents pack paths or local delete tickets.

Treat Drive/iCloud/NAS packs as untrusted until pack **and** sidecar exist and
hash-verify. Partial sync files are not restorable and must never authorize
offload. Piwin never auto-deletes external packs.

## Package ownership

| Package | Responsibility |
|---------|----------------|
| `@piwin/contracts` | Storage state, cold-storage config, plan/execute/status/restore/reconcile types, stable errors |
| `@piwin/session` | Pack adapter, hashing, eligibility, journals, offload/restore/reconcile, index stub persist |
| `@piwin/host-runtime` | Commands, in-memory plans, storage coordinator, startup journal recovery, config persist |
| Desktop/CLI | Presentation + Host commands only; no second HostRuntime against the same root |

## Consequences

- Users can reclaim Host disk without losing discoverability.
- Opening an offloaded session cannot mint an empty transcript.
- Crash mid-offload is recoverable; unknown split-brain stays visible.
- External retention (Drive/NAS cleanup, versioning) is the user's job.
- Remote clients see storage state, never Host pack paths.
- R1 has no schedule, no force-replace, and no coordinated pack+index purge.

## Rejected alternatives

1. **Merge with archive lifecycle** — archive is visibility; offload is
   payload movement. Combining them hides a destructive step.
2. **Merge with ADR 0040 runtime cold** — runtime eviction must stay cheap and
   reversible without touching durable files.
3. **Staging-only destructive offload** — deleting local payload before a
   verified published pack can destroy the only copy.
4. **`--from-pack` offload** — would treat an older pack as authority over
   current local data.
5. **Force replace local body** — silent overwrite of the only local copy.
6. **Persist an executable delete ticket** — a restart should never resume a
   delete the user can no longer see.
7. **Recreate an empty `transcript.sqlite3` from the stub** — the hard
   acceptance failure this ADR exists to prevent.
8. **Shell `zip`/`unzip`** — no streaming hash, no zip-slip control, no
   maintained adapter.
9. **Automatic schedule in R1** — schedule is a later product on top of a
   proven manual loop.
10. **Weekly multi-session packs** — one session per pack keeps restore and
    hash verification local and reversible.

## Future replacement point

R2+ may add automatic cold planning after lifecycle archive, optional
media-less packs, a remote Host directory browser, or coordinated permanent
delete of index + local + external pack. Those require new ADRs. The R1
invariants (plan+confirm, published-pack-before-delete, no empty-transcript
recreate, Host path semantics) remain.
