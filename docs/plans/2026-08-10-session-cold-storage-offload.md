# Session cold storage / offload packs — execution plan

| Field | Value |
|-------|-------|
| Status | **Revised draft (post-review) — ready for WP0/WP1** |
| Date | 2026-08-10 |
| Revision | R1 — review pass incorporated (see §0) |
| Primary owner | `@piwin/session` + `@piwin/host-runtime` |
| Surfaces | contracts → session → host-runtime → CLI → Desktop (later) |
| Related | ADR 0040 (durable transcript vs live runtime); PD-SESS archive lifecycle; CE-SHARE-01 export (**share-only, not cold storage**); branch `feat/session-lifecycle-archive` (**orthogonal** local archive policy) |

## 0. Review summary (R1)

A design review against current main (`transcript.sqlite3` + WAL, `SessionSummary`,
pet zip patterns, multi-client Host) produced these **must-fix** items. They are
folded into the locked decisions and work packages below — do not implement the
pre-review draft without them.

| Sev | Finding | Resolution in this revision |
|-----|---------|-----------------------------|
| P0 | `archiveSha256` cannot live *inside* the zip it hashes (chicken-and-egg) | Manifest holds **per-session** hashes only; **archive** hash is sibling `*.piwin-pack.sha256` only |
| P0 | Transcript DB uses `PRAGMA journal_mode=WAL` — copying only `transcript.sqlite3` while open (or with dirty `-wal`) is corrupt | Offload **must** `registry.close` → checkpoint/truncate WAL → copy main DB only |
| P0 | Attachment paths in transcript are often absolute under `~/.piwin/media/<id>/` — import without rewrite breaks media | Import rewrites media refs (same family as fork `cloneSessionMedia`) |
| P0 | Writing pack **directly** into a Google Drive sync folder risks partial-cloud uploads | Stage under `~/.piwin/pack-staging/`, verify, **then** publish copy into `packOutputDir` |
| P1 | `SessionSummary` / list lifecycle today are only `active\|archived` — UI cannot show offloaded without contract work | WP1 adds `storageState` on summary + list/search filters |
| P1 | Repo has **unzip via host CLI** (pet), not a pack **create** library | Lock v1 on **host `zip`/`unzip`** with injectable overrides (pet pattern); pure-JS zip is v2 optimization |
| P1 | If Host is remote (ADR 0036), `packOutputDir` is on the **Host machine**, not the laptop Drive folder | Docs + status must state authority machine; local-Host is the primary v1 story |
| P1 | Measuring every session dir on each plan can be slow at scale | Size cache in `cold-storage-state.json` with invalidation on transcript/media update / offload / import |
| P2 | Multiple packs per ISO week (`2026-W32`, `2026-W32-2`) confuse restore | Stubs always store full `packId`+`packPath`; `pack list` groups by week label |
| P2 | ISO week boundary depends on timezone | **Lock UTC** for week bucketing from `archivedAt`/`updatedAt` |
| P2 | Side-chat / lineage when main is offloaded | v1: main-only offload; side-chats stay local; opening side-chat does not require main body |
| P2 | Index JSON grows with eternal stubs | Acceptable for v1 (stubs are small); index SQLite migration stays out of scope |
| P2 | `cold plan --execute` naming blurs plan vs destructive offload | CLI: `plan` never deletes; only `offload --execute` / `pack create` write |

**Verdict:** Direction is right and matches the product intent (hot local + weekly
cold packs + stub catalog + Drive-as-folder). It is **not** implementation-ready
until P0 items are treated as non-negotiable in WP3/WP5. Pre-review prose that
conflicted with the table above is superseded by R1.

---

## 1. Outcome

After this plan ships, a user can:

1. Keep a **bounded local hot set** of product sessions (configurable disk budget).
2. When local usage exceeds the budget (or on manual demand), **pack** older
   archived sessions into **reversible weekly cold packs**.
3. **Publish** those packs into an external directory the user controls
   (typically a Google Drive / Dropbox / NAS sync folder). Local disk drops
   the heavy payload; the product index keeps a **stub catalog**.
4. Later, **discover** cold sessions in piwin (title / project / week / preview),
   pick a pack, **import** it back, then full-text search and resume as usual.

**One-line product promise:**  
*Local disk stays small; history remains findable; any week can be restored
without treating the cloud as a live database.*

## 2. Problem and non-goals

### 2.1 Problem

Product transcripts live in per-session `transcript.sqlite3` (ADR 0040, WAL).
Long-term local growth is unbounded (chats + media under `~/.piwin`). Users want:

- reclaim of local disk under a budget;
- history on cheap external storage;
- selective restore (often by calendar week);
- piwin-native discovery of what was offloaded (not folder archaeology).

### 2.2 Explicit non-goals (v1)

| Do not | Why |
|--------|-----|
| Mount Drive/Dropbox as live SQLite | Locking, partial sync, multi-writer corruption |
| Vendor cloud SDKs | Folder path is enough |
| Use `session/export` MD/HTML as cold storage | Lossy; not product-restorable |
| Multi-device merge of one session | Host is single hot authority |
| Auto-delete remote packs | piwin does not own cloud delete |
| Pack or compress **open/live** DBs | Only closed, checkpointed sessions |
| Replace `archive` / `unarchive` / `delete` | Different axis (see §2.3) |
| Full-text search of unimported pack bodies | Stub search only |
| Auto-offload pinned / live / side-chat / subagent (defaults) | Safety |
| Encrypt packs | Document sensitivity; crypto is a later slice |
| Move Pi kernel JSONL into packs | Product transcript + media only in v1 |

### 2.3 Orthogonal axes (do not conflate)

```text
archive     = UI lifecycle soft-hide (isArchived). Body still local by default.
offload     = storage residency: heavy payload removed; stub + pack pointer remain.
delete      = permanent destroy of index row (+ local files if any). Does not delete remote pack.
export md   = human share copy; not authoritative restore.
runtime idle= ADR 0040 memory residency; unrelated to disk packs.
```

Typical states:

| Lifecycle | Storage | Meaning |
|-----------|---------|---------|
| active | local | Normal hot session |
| archived | local | Hidden from default list; body on disk |
| archived | offloaded | Hidden; body in pack; stub in index |
| archived | missing-pack | Stub present; pack file not found |
| (any) | local after import | Restored; archive flag unchanged |

## 3. Locked decisions (R1)

| ID | Decision |
|----|----------|
| D1 | **Hot authority:** Host local `transcript.sqlite3` + media vault. |
| D2 | **Cold authority:** pack file(s) on disk the user manages; local index holds **stub only**. |
| D3 | **Default pack unit:** ISO **week in UTC** from `archivedAt` ?? `updatedAt`. Manual ad-hoc packs allowed. |
| D4 | **Pack portable unit:** `.piwin-pack` = zip. Debug may extract to a directory with the same layout. |
| D5 | **Reversible:** import restores product-equivalent transcript DB + optional media; **session id and message ids preserved**. |
| D6 | **Stub always retained** on successful offload (until user deletes the session). |
| D7 | **Remote = user folder on the Host filesystem.** `packOutputDir` is where packs are **published**. No cloud API in v1. |
| D8 | **Safety order:** close handles → WAL checkpoint → stage pack under `~/.piwin/pack-staging/` → hash verify → **publish** to `packOutputDir` → verify publish → **then** delete local payload. |
| D9 | **Safe defaults:** `enabled: false`, `dryRun: true`, pinned exempt, main-only, `requireArchived: true`, schedule `never`. |
| D10 | **Budget:** `localBudgetBytes` + `reclaimTargetBytes`. If reclaim omitted while over budget, runtime uses `min(512 MiB, overage)`. |
| D11 | **Media default in packs:** `includeMedia: true`. Text-only packs allowed; restore may lack binaries until a media-capable pack is imported. |
| D12 | **Cold search:** index/stub fields only; UI labels `storageState`. |
| D13 | **Idempotency:** re-offload of offloaded session = skip; import onto existing local body = fail unless explicit `force: 'replace-local'` (CLI requires typing session id). |
| D14 | **Config home:** `PiwinConfig.session.coldStorage` (beside `runtimeRetention`). |
| D15 | **Integrity split:** per-session content hashes in `manifest.json`; **whole-archive** hash only in sibling `*.piwin-pack.sha256`. |
| D16 | **Zip I/O v1:** host `zip` / `unzip` CLIs with dependency-injected overrides for tests (same approach as `@piwin/pet` unzip). |
| D17 | **Staging dir:** `~/.piwin/pack-staging/` (never primary-write into cloud sync dir). |
| D18 | **Week file names:** first pack `2026-W32.piwin-pack`; collisions get `2026-W32-2`, … (no in-place zip append in v1). |
| D19 | **Unarchive while offloaded:** refuse; error tells user to import first. |
| D20 | **Pi kernel JSONL / `piSessionFile`:** not included in v1 packs. Product resume path is transcript-store-based (ADR 0040). |
| D21 | **Primary deployment assumption v1:** Desktop/CLI talking to a **local** Host. Remote Host: packs live on server disk; document limitation. |

## 4. Concepts and state machine

### 4.1 Storage residency (new axis)

Independent of `isArchived`:

```text
local         — transcript DB (and media policy files) present under ~/.piwin
offloaded     — local heavy payload removed; stub + pack pointer remain
missing-pack  — stub says offloaded but pack not found at last path / output dir
```

Transient `packing` may exist in-memory during a run; **do not** persist it on
index rows (crash should leave `local` or completed `offloaded`, not a sticky
halfway enum). Crash during delete-after-publish is repaired by reconcile:
pack exists + local files exist → prefer keep local and clear offload, or
doctor prompt (see §13).

### 4.2 Index fields (additive)

On `SessionIndexRecord`:

```ts
/** Disk residency of durable transcript/media. Absent = local (legacy). */
storage?: {
  state: 'local' | 'offloaded' | 'missing-pack';
  /** e.g. "2026-W32" or "2026-W32-2" or "adhoc-20260810T153012Z" */
  packId?: string;
  /** Last known absolute path of the published pack zip on the Host. */
  packPath?: string;
  /** sha256 hex of this session's transcript file as packed. */
  transcriptContentHash?: string;
  /** sha256 hex of the published archive (mirrors sidecar) for quick checks. */
  packArchiveHash?: string;
  offloadedBytes?: number;
  offloadedAt?: string;
  mediaIncluded?: boolean;
  /** Bounded text for cold search; often copy of lastPreview / first user line. */
  coldPreview?: string;
};
```

On `SessionSummary` (IPC list/search cards):

```ts
storageState?: 'local' | 'offloaded' | 'missing-pack'; // omit or 'local' for legacy
packId?: string;
```

`SessionListLifecycle` stays `active | archived` (lifecycle only).  
Add **orthogonal** query field on list/search:

```ts
storage?: 'local' | 'offloaded' | 'any'; // default 'any' for search; list default 'local'
// When listing archived, default storage 'any' so offloaded archived remain visible with badge.
```

Exact default for archived tab: show **local + offloaded** archived rows (recommended).

### 4.3 State transitions

```text
                 archive                 offload (verified publish)
  active+local ──────────► archived+local ────────────────────────► archived+offloaded
       ▲                         │                                      │
       │ unarchive               │ delete                               │ import
       │ (local only)            ▼                                      ▼
       └──────────── local ◄──── destroy stub              archived+local (still archived)
```

Rules:

- **Offload candidates (auto):** archived, not offloaded, not live, not pinned
  (if excludePinned), `kind === 'main'` (if mainSessionsOnly), age gate.
- **Import:** restores files; sets `storage.state = 'local'`; **does not** unarchive.
- **Delete offloaded:** drop index row; **do not** delete remote pack (result
  includes `packPath` for manual cleanup).
- **Unarchive offloaded:** error → import first (D19).

## 5. Pack format (v1)

### 5.1 Zip layout

```text
piwin-pack/
  manifest.json
  sessions/
    <sessionId>/
      transcript.sqlite3       # required when that was authority
      plan.json                # optional sidecar if present
      meta.json                # pack-time index snapshot + per-file hashes
  media/
    <sessionId>/
      …                        # iff includeMedia
```

Do **not** require shipping `transcript.json` / `.v1.bak` in v1 if sqlite
authority is verified; optional include of backup is a size tradeoff (default
**omit** backups to save space).

### 5.2 `manifest.json`

```ts
type PiwinSessionPackManifestV1 = {
  version: 1;
  packId: string;
  createdAt: string;
  createdBy: 'piwin';
  piwinPackFormat: 'session-cold/v1';
  label: string; // "2026-08-03 – 2026-08-09" (UTC week range)
  grouping:
    | { mode: 'iso-week'; week: string } // week === packId prefix without -N suffix
    | { mode: 'adhoc'; reason?: string };
  includeMedia: boolean;
  bytes: { payload: number; archive?: number }; // archive filled after zip+stat, in sidecar flow
  sessions: Array<{
    sessionId: string;
    projectPath: string;
    scope?: SessionScope;
    name?: string;
    kind: 'main' | 'subagent' | 'side-chat';
    createdAt: string;
    updatedAt: string;
    archivedAt?: string;
    messageCount: number;
    coldPreview?: string;
    transcriptSha256: string;
    mediaTreeSha256?: string;
    bytes: { transcript: number; media: number; total: number };
  }>;
};
```

**No `archiveSha256` field inside manifest** (D15). After zip finalize:

```text
2026-W32.piwin-pack
2026-W32.piwin-pack.sha256   # single line: "<hex>  2026-W32.piwin-pack"
```

### 5.3 WAL / copy protocol (mandatory)

For each session before reading bytes into the pack:

1. `SessionTranscriptStoreRegistry.close(sessionId)` (and ensure no command lease).
2. Open DB briefly or use sqlite API to run `PRAGMA wal_checkpoint(TRUNCATE);` then close  
   **or** delete orphan `-wal`/`-shm` only when checkpoint guarantees empty WAL  
   (implementer picks one path; tests must prove a dirty-WAL fixture cannot be packed).
3. Hash and copy **only** `transcript.sqlite3`.
4. Refuse pack if `-wal` still non-empty after checkpoint attempt.

### 5.4 Publish protocol

1. Build zip in `~/.piwin/pack-staging/<packId>.piwin-pack.partial`.
2. Rename to `…/pack-staging/<packId>.piwin-pack`.
3. Write staging sha256 sidecar.
4. Verify: re-hash zip matches sidecar; spot-check zip entries vs per-session hashes.
5. Copy/move zip + sidecar to `packOutputDir` (cloud folder).
6. Re-hash the **published** file (Defend against failed cloud copy).
7. Only then update index stubs and delete local payload.
8. Delete staging copy after successful publish (or keep until offload fully done).

### 5.5 Import and media path rewrite

1. Verify published sha256 sidecar if present (default **require** match).
2. Extract to temp under pack-staging.
3. For each session: refuse if local authority DB exists unless `force: 'replace-local'`.
4. Move `transcript.sqlite3` into `sessions/<id>/`.
5. If media present: restore under `media/<id>/` and **rewrite** attachment paths
   inside the store (or on first open migration) to the current root.  
   Reuse patterns from fork/duplicate media clone — do not leave old machine paths.
6. Smoke: `openSessionTranscriptStore` → `messageCount` matches manifest.
7. Mark `storage.state = 'local'`.

## 6. Configurable policy

### 6.1 Config shape

`PiwinConfig.session.coldStorage`:

```ts
export type SessionColdStorageConfig = {
  /** Automatic planner/scheduler master switch. Default false. */
  enabled: boolean;

  /**
   * Soft cap on local durable payload bytes.
   * Undefined = do not auto-enforce budget (manual pack/offload still work).
   */
  localBudgetBytes?: number;

  /**
   * When over budget, aim to free at least this many bytes in one plan.
   * If omitted: min(512_000_000, overage) at plan time.
   */
  reclaimTargetBytes?: number;

  /** Candidates must be older than N days (archivedAt ?? updatedAt). */
  minAgeDays?: number;

  /** Default true — bucket by UTC ISO week. */
  groupByIsoWeek: boolean;

  /** Default true. */
  excludePinned: boolean;

  /** Default true — only kind=main. */
  mainSessionsOnly: boolean;

  /**
   * Default true — offload only isArchived sessions.
   * Manual CLI may pass --archive-first to archive+offload in one confirmed run
   * without flipping this default.
   */
  requireArchived: boolean;

  /** Default true. */
  includeMedia: boolean;

  /** Publish target directory (e.g. Drive sync folder). Required for execute paths. */
  packOutputDir?: string;

  /** Default 'never'. */
  schedule: 'never' | 'weekly' | 'monthly';

  /**
   * Default true — plan/status only; no local payload deletion.
   * pack create may still write a pack when explicitly invoked
   * (non-destructive backup). offload honors dryRun strictly.
   */
  dryRun: boolean;

  /** Default true — media counts toward localBudgetBytes. */
  accountMediaInBudget: boolean;
};

export function createDefaultSessionColdStorageConfig(): SessionColdStorageConfig {
  return {
    enabled: false,
    groupByIsoWeek: true,
    excludePinned: true,
    mainSessionsOnly: true,
    requireArchived: true,
    includeMedia: true,
    schedule: 'never',
    dryRun: true,
    accountMediaInBudget: true,
  };
}
```

Also extend `SessionConfig`:

```ts
export type SessionConfig = {
  autoName?: boolean;
  runtimeRetention?: SessionRuntimeRetentionConfig;
  coldStorage?: SessionColdStorageConfig;
};
```

### 6.2 Example (user intent)

Local ~2 GiB hot cap; shed ~500 MiB per run; packs into Drive folder; confirm first:

```json
{
  "session": {
    "coldStorage": {
      "enabled": true,
      "localBudgetBytes": 2147483648,
      "reclaimTargetBytes": 524288000,
      "minAgeDays": 14,
      "groupByIsoWeek": true,
      "packOutputDir": "/Users/me/Library/CloudStorage/GoogleDrive-me/My Drive/piwin-packs",
      "schedule": "weekly",
      "dryRun": true,
      "includeMedia": true
    }
  }
}
```

### 6.3 Normalization

- Budget/reclaim if set: minimum **64 MiB**.
- `minAgeDays` if set: 1..3650.
- `packOutputDir`: expand `~`; must be absolute; **reject** if inside
  `rootDir/sessions`, `rootDir/pack-staging`, or equals `rootDir`.
- Unknown `schedule` → `never`.
- Partial objects merge onto defaults; missing `enabled` → false.

## 7. Commands and CLI

### 7.1 Host commands

```ts
{ type: 'session/cold-storage-status' }

/** Always non-destructive. */
{ type: 'session/cold-storage-plan' }

/** Write pack only (backup-friendly). Does not delete local payload. */
{
  type: 'session/pack-create';
  sessionIds?: string[];
  packId?: string;
  includeMedia?: boolean;
  outputDir?: string; // override publish dir; staging always local first
}

/** Pack (if needed) + verified publish + delete local payload + stubs. */
{
  type: 'session/offload';
  sessionIds?: string[];
  packPath?: string; // offload sessions listed in an existing verified pack
  archiveFirst?: boolean; // manual escape hatch; still refuses live/pinned per flags
  dryRun?: boolean; // default = config.dryRun
}

{ type: 'session/pack-list'; dir?: string }

{
  type: 'session/pack-import';
  packPath: string;
  sessionIds?: string[];
  force?: false | 'replace-local';
}

{ type: 'session/cold-storage-reconcile' }
```

All result types live in contracts.

### 7.2 CLI

```text
piwin session cold status
piwin session cold plan
piwin session pack create [--session id]... [--out dir] [--no-media]
piwin session pack list [--dir dir]
piwin session pack import <path> [--session id]...
piwin session offload (--session id... | --from-pack <path>) [--archive-first] [--execute]
piwin session cold reconcile
```

Rules:

- `plan` / `status` / `pack list` never delete.
- `pack create` never deletes local session payload.
- `offload` without `--execute` forces dry-run even if config `dryRun: false`.
- `offload --execute` allowed only when config `dryRun: false` **or**
  `--execute` is combined with an explicit env/flag policy documented as
  “I understand local files will be removed after verified publish”
  (pick one UX in WP6; prefer: `--execute` overrides config dryRun for one shot
  **and** prints a confirm summary counting bytes — no interactive prompt in CI).

### 7.3 Desktop (WP8, deferrable)

- Settings: budget, folder picker, dry-run, include media, schedule.
- Row badge: Local / Offloaded / Pack missing.
- Search → import sheet.
- “Free up disk…” → shows **plan** → user confirms → offload execute.

## 8. Planner (pure)

```ts
function planColdOffload(input: {
  records: SessionIndexRecord[];
  sizes: Map<string, { transcriptBytes: number; mediaBytes: number }>;
  liveIds: Set<string>;
  policy: NormalizedSessionColdStorageConfig;
  now: Date; // UTC
}): SessionColdStoragePlan
```

Algorithm:

1. Sum local used from sizes for non-offloaded sessions (media per flag).
2. If budget set and `used <= budget` → empty plan (manual ids use other API).
3. `overage = used - budget`; `reclaimTarget = policy.reclaimTargetBytes ?? min(512MiB, overage)`.
4. Filter candidates (archived/live/pin/main/age/storage).
5. Sort oldest first (`archivedAt ?? updatedAt`, tie-break `id`).
6. If `groupByIsoWeek`: bucket UTC ISO weeks; take whole oldest weeks until
   cumulative ≥ reclaimTarget (may overshoot for week atomicity).
7. Else greedy sessions until target.
8. Emit packs with stable `packId` suggestions (`YYYY-Www`, caller resolves
   collisions against existing files at execute time).
9. Unknown size → exclude from auto plan; status lists `unmeasuredCount`.

## 9. Offload execution pipeline

1. Resolve session set (from plan or explicit ids).
2. Refuse any live / leased / active-run session (no force in v1).
3. Close registry entries; WAL checkpoint protocol (§5.3).
4. Measure + hash sources; refresh size cache.
5. Stage zip + sidecar under pack-staging (§5.4).
6. Publish to `packOutputDir`; verify published hash.
7. If dry-run: report; **delete nothing**.
8. If execute: batch index update under one write lock → delete session dirs →
   delete media dirs if included → keep stubs.
9. Per-session failures accumulate; do not leave `offloaded` stub without
   successful publish for that session.
10. Update `~/.piwin/cold-storage-state.json` (`lastRunAt`, last plan summary,
    size cache entries).

**Global lock:** one cold-storage run at a time per Host process (mutex).

## 10. Import pipeline

See §5.5. Additional:

- `pack-list` scans `packOutputDir` for `*.piwin-pack` + manifests (lazy open).
- Subset import allowed; stub/pack pointer cleared only for restored ids.
- If pack contains sessions not in index, **re-create** index rows from
  `meta.json` / manifest (recovery path).

## 11. Search and list semantics

| State | Archived list | Body search | Open |
|-------|---------------|-------------|------|
| local active | (active list) | yes | normal |
| local archived | yes | yes | resume / unarchive |
| offloaded | yes + badge | stub only | CTA import |
| missing-pack | yes + warning | stub only | locate pack / reconcile |

Implement body search skip when `storage.state === 'offloaded' | 'missing-pack'`
(do not probe missing sqlite paths).

## 12. Work packages

### WP0 — Freeze & fixtures

- [ ] This plan R1 accepted.
- [ ] Fixtures: 12 sessions / 3 UTC weeks / known sizes / one dirty-WAL case.
- [ ] live, pinned, side-chat exclusion fixtures.
- [ ] Temp rootDir + packOutputDir + fake Drive dir.

**Exit:** pure planner tests runnable.

### WP1 — Contracts

- [ ] `SessionColdStorageConfig` + defaults + normalize.
- [ ] `SessionIndexRecord.storage`, `SessionSummary.storageState`/`packId`.
- [ ] List/search query `storage` filter.
- [ ] Manifest + command/result types; capability bit if required.
- [ ] Exhaustive switches (host, desktop mock, cli, remote projections as needed).

**Exit:** contracts typecheck; legacy clients ignore new fields.

### WP2 — Measure, cache, plan (`@piwin/session`)

- [ ] `measureSessionLocalBytes`.
- [ ] UTC ISO week helpers.
- [ ] `planColdOffload` pure.
- [ ] Size cache read/write helpers (state file schema).

**Exit:** unit tests for budget, week atomicity, filters, empty plan.

### WP3 — Pack create / verify / import

- [ ] Host zip/unzip wrappers + test inject.
- [ ] Staging create + sidecar sha256.
- [ ] WAL checkpoint gate + dirty-WAL refusal test.
- [ ] Round-trip open store + messageCount.
- [ ] Media restore + **path rewrite** tests.
- [ ] Zip-slip path rejection.

**Exit:** Gate A (below).

### WP4 — Index integration

- [ ] mark offloaded / local; tolerant load.
- [ ] delete offloaded stub-only.
- [ ] search/list storage filters.
- [ ] unarchive guard when offloaded.

**Exit:** index tests + reload persistence.

### WP5 — Host commands

- [ ] paths: `pack-staging`, cold-storage-state, publish dir checks.
- [ ] status/plan/pack-create/offload/pack-list/pack-import/reconcile.
- [ ] registry close + live gate + single-flight mutex.
- [ ] remote-Host note in status (`authority: 'host-fs'`).

**Exit:** host-runtime temp-fs tests green.

### WP6 — CLI

- [ ] Commands in §7.2 with MiB tables and dry-run banners.
- [ ] Non-zero exit on partial failure.

**Exit:** Gate C script.

### WP7 — Scheduler (optional)

- [ ] `enabled && schedule !== 'never'` → periodic **plan** log/push.
- [ ] Auto offload execute only if `dryRun: false` (advanced); default never.

**Exit:** injected clock tests; defaults silent.

### WP8 — Desktop (defer)

- [ ] Settings + badges + import CTA + free-disk plan modal.

### WP9 — Docs & doctor

- [ ] `docs/guides/session-cold-storage.md`
- [ ] Doctor: budget, missing packs, orphan dirs, dirty WAL, staging leftovers
- [ ] Clarify vs archive vs MD export vs remote Host

## 13. Safety matrix

| Hazard | Mitigation |
|--------|------------|
| Delete before durable pack | D8; dryRun default; publish re-hash |
| Cloud partial file | staging then publish; `.partial` never published |
| WAL corrupt copy | checkpoint gate; dirty-WAL test |
| Live writer | refuse live/lease/active run |
| Zip slip | allowlist entry prefixes |
| Import clobber | default refuse; force ceremony |
| Drive deletes pack | missing-pack + stub retained |
| Attachment 404 after import | media rewrite |
| Concurrent offload | process mutex |
| Crash after publish before delete | reconcile: both exist → keep local, leave pack (idempotent re-offload later) |
| Crash after delete before index update | reconcile: pack has session, no local, index still local → mark offloaded from manifest |
| Secrets in packs | document = as sensitive as `~/.piwin` |
| Remote Host + laptop Drive | status/docs: pack dir is Host-local |

## 14. Status payload

```ts
type SessionColdStorageStatus = {
  localUsedBytes: number;
  localBudgetBytes?: number;
  overBudgetBytes: number;
  offloadedSessionCount: number;
  localSessionCount: number;
  missingPackCount: number;
  unmeasuredCount: number;
  packOutputDir?: string;
  packOutputDirWritable?: boolean;
  stagingDir: string;
  authority: 'host-fs';
  lastRunAt?: string;
  lastPlanSummary?: { packCount: number; sessionCount: number; bytes: number };
  dryRun: boolean;
  enabled: boolean;
  warnings: string[]; // e.g. enabled without packOutputDir
};
```

## 15. Rollout

| Stage | Scope | Risk |
|-------|-------|------|
| **S1** | WP0–WP3 + CLI `pack create` / `pack import` | Low — backup/migrate only |
| **S2** | Offload + stubs + status/plan | Medium — local delete after verify |
| **S3** | Reconcile + doctor + search/storage filters | Medium |
| **S4** | Scheduler + Desktop | Low if dryRun default holds |

Default config never offloads. First merge recommendation: **S1 only**.

## 16. vs `feat/session-lifecycle-archive`

| Old branch | This plan |
|------------|-----------|
| Auto-archive by age/count | Optional **separate** precursor; offload defaults to already archived |
| gzip `transcript.json` | **Obsolete** for cold path |
| `retentionDays` auto-delete | **Not** in cold storage |
| `general.sessionArchive` | Use `session.coldStorage` |

Do not port gzip compression onto sqlite.

## 17. Verification gates

### Gate A — Pack fidelity (S1)

- Round-trip ids + messageCount + media open.
- Dirty WAL fixture refused.
- Tampered sha256 refused.
- Zip-slip refused.

### Gate B — Offload safety (S2)

- dryRun / missing `--execute` never deletes.
- execute deletes only after published hash OK.
- live skipped.
- stub name-searchable after offload.

### Gate C — CLI loop

```bash
piwin session cold status
piwin session cold plan
piwin session pack create --session <id> --out /tmp/piwin-packs
piwin session offload --from-pack /tmp/piwin-packs/<pack>.piwin-pack --execute
piwin session pack import /tmp/piwin-packs/<pack>.piwin-pack
```

### Gate D — Desktop (S4)

Settings round-trip; badge; import from search (mock host).

## 18. Remaining small opens (resolve in WP1/WP3, do not block plan accept)

1. Exact `--execute` vs config `dryRun` override semantics (WP6 pick one; document).
2. Whether `pack create` without `packOutputDir` may write only to staging and
   print path (useful backup) — **recommend yes**.
3. Media-only follow-up pack format if text-only pack was used first — **v2**.
4. Optional pack encryption — **v2**.

## 19. Done definition (S2)

1. Safe defaults land in config.
2. User can set budget, ~500 MiB reclaim, and `packOutputDir` to a Drive folder.
3. `cold plan` proposes UTC week packs totaling ≥ reclaim target when over budget.
4. `offload --execute` publishes verified `.piwin-pack` + `.sha256`, leaves stubs,
   frees local bytes.
5. `pack import` restores store + media paths; body search works.
6. No default path deletes remote packs or local data without verification.
7. Tests cover planner, WAL gate, round-trip, dry-run, path rewrite.
8. Guide states Drive is a **folder on the Host**, not a live DB.

---

## Appendix A — Mapping “500MB extra”

```text
localBudgetBytes   = hot cap on the machine
reclaimTargetBytes = per-run shed target (≈ 500 MiB)
minAgeDays         = protect recent work
groupByIsoWeek     = restore granularity
packOutputDir      = Google Drive (or other) sync directory
```

No hard-coded 500 MiB contract constant; runtime default reclaim is
`min(512 MiB, overage)` when over budget and reclaim is omitted.

## Appendix B — Minimal manifest example

```json
{
  "version": 1,
  "packId": "2026-W32",
  "createdAt": "2026-08-10T12:00:00.000Z",
  "createdBy": "piwin",
  "piwinPackFormat": "session-cold/v1",
  "label": "2026-08-03 – 2026-08-09",
  "grouping": { "mode": "iso-week", "week": "2026-W32" },
  "includeMedia": true,
  "bytes": { "payload": 480001234 },
  "sessions": [
    {
      "sessionId": "ses_abc",
      "projectPath": "/Users/me/proj",
      "name": "Fix cold start",
      "kind": "main",
      "createdAt": "2026-08-04T10:00:00.000Z",
      "updatedAt": "2026-08-05T18:00:00.000Z",
      "archivedAt": "2026-08-09T01:00:00.000Z",
      "messageCount": 42,
      "coldPreview": "Why does resume load everything?",
      "transcriptSha256": "…",
      "bytes": { "transcript": 1200000, "media": 8000000, "total": 9200000 }
    }
  ]
}
```

Sibling:

```text
2026-W32.piwin-pack.sha256
<hex>  2026-W32.piwin-pack
```
