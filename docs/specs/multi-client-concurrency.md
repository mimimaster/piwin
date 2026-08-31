# Multi-client concurrency on one Host

| Field | Value |
|-------|-------|
| Status | **Implementation authority** |
| Date | 2026-08-20 |
| Depends | ADR 0036, ADR 0048, ADR 0051, [`host-server-multi-client.md`](./host-server-multi-client.md), [`run-interventions.md`](./run-interventions.md) |
| Does not replace | Pairing/auth ([hybrid continuity](../superpowers/specs/2026-08-13-hybrid-host-mobile-continuity-design.md) §5), remote allowlist policy, PTY design |

This document is the implementable contract for several shells mutating one Host process. Clients branch on `HostProblem.code`, not on `error` text.

Out of scope: Host-to-Host replication, one window bound to two Hosts, CRDT merge of document text, crash-durable idempotency across `hostInstanceId` change.

---

## 1. Topology invariants

1. One `~/.piwin` data root has at most one live `HostRuntime` / `HostServer` process.
2. N shells may attach to that process (Desktop, later CLI/mobile). Observation is shared. Opening a session does not take a lease and does not evict another shell.
3. A shell has exactly one active Host connection. Switching Hosts discards in-memory session/settings state and hydrates the new `hostInstanceId`.
4. Bundled sidecar (JSONL) and standalone `apps/host` (WebSocket) are two ways to reach a Host. They must not run against the same data root at the same time.
5. CLI in-process `HostRuntime` is a third process. Until CLI attaches to an existing Host, it is not a participant in this contract.

**S0 (required before treating multi-client as supported):** Host writes an exclusive lock file under the data root at start and refuses to boot if the lock is held by a live pid. Desktop attach and `apps/host` both use it. Document the failure in the connect wall.

---

## 2. Primitives

Every mutating command uses exactly one of these. Do not add a fifth.

| Primitive | Token | On mismatch | Used for |
|-----------|--------|-------------|----------|
| **Document CAS + domain rebase** | `expectedRevision` + per-mutated-domain hashes | typed conflict, return latest snapshot | `settings/apply`; notes update/delete; `todo/set`; `plan/*` writes |
| **Named admission** | `runId` / `checkpointId` / `queuedTurnId` / `interventionId` + `PromptForegroundAdmission` | `foreground-run-mismatch` or revision mismatch; no mutation | prompt, abort, pause/resume, replace, intervention, queued-turn adopt |
| **Single-consume ticket** | `requestId` (permission / extension UI / pairing token) | already consumed | `permission/resolve`, `extension/ui_resolve` |
| **Last write + index push** | none | not a user-facing conflict | rename, pin, archive, auto-name (skips user-set names) |
| **Exclusive Host job** | job/folder/message key | second caller sees in-progress or `busy` | compact, cold-storage, doccards index/generate, walkthrough generate, notes reindex |

**Idempotency is not admission.** `(devicePrincipalId, idempotencyKey)` answers “did this click already run”. Admission answers “is the session still in the state I named”.

Rules:

- One user gesture creates one key. Transport retry of that gesture reuses the key.
- Host scopes by device principal (pairing id, else hello `clientId` until pairing ships). Bind the key to a canonical command digest. Same key + different digest → `idempotency-conflict`.
- Reserve the key before side effects. In-flight duplicates join one result.
- Completed results replay. Keys live for the Host process. New `hostInstanceId` drops the table.
- Changing intent (if-idle prompt → queued-turn, or → replace-run) is a new gesture and a new key.

**Idempotency admission (resolved):** `@piwin/host-client.request` does not mint keys. Required mutations without a caller-owned `idempotencyKey` fail with `idempotency-key-required` before Host admission. Gesture retry reuses a frozen `HostRequestAttempt`. Host keeps completed keys for the process lifetime (`hostInstanceId`); overload is `idempotency-registry-capacity` with no silent eviction. Local JSONL uses the same registry through a versioned request envelope.

---

## 3. Serialization locks (Host)

| Lock | Scope | Already exists |
|------|--------|----------------|
| `PromptAdmissionGate` | `sessionId` | yes — `session-prompt-admission.ts` |
| `SettingsService.mutationChain` | process | yes |
| pending-permission map | `requestId` | yes |
| note write | `noteId` | **no** — add |
| session body job | `sessionId` (compact / truncate / delete / pack) | **no** — reuse admission gate or a sibling `SessionBodyGate` |
| cold-storage | process | **no** — add |
| walkthrough | `(sessionId, messageId)` | check existing generate; serialize if missing |
| doccards | folder | progress pushes exist; enforce single job per folder |
| cron upsert | `jobId` | serialize with settings-like CAS or last-write on that id |

Two `if-idle` prompts on the same idle session: gate admits one. Loser gets `foreground-run-mismatch` / `active` with the winner’s `runId`. Winner’s user message is pushed; loser must not keep a committed optimistic row.

Two `replace-run` for the same `runId`: one reservation. Loser gets `transitioning` or `changed`.

---

## 4. Prompt / run / queue

Product verbs (ADR 0051) are the same on every shell:

| Gesture | When | Command |
|---------|------|---------|
| Send | idle | `session/prompt` + `foreground: { kind: 'if-idle' }` |
| Send | foreground run known | `session/queued-turn-submit` |
| Send | client believed idle, Host busy | Host refuses prompt; client asks queue vs replace vs cancel |
| Adjust after step | run known | `run/intervention-submit` + `runId` |
| Stop and send this | user confirmed | `session/prompt` + `foreground: { kind: 'replace-run', runId }` or `session/replace-run` |
| Stop | run known | `session/abort` + `runId` |
| Pause / continue / discard | exact ids | `session/pause` + `runId`; resume/discard + `checkpointId` |

Remote must send `foreground` on `session/prompt`. Local JSONL may omit (current). Desktop attached to a remote Host follows the remote column.

Do not auto-convert a failed `if-idle` prompt into a queued turn or a replace.

### 4.1 Admission table

Unchanged from hybrid §7.3 / `evaluatePromptForegroundAdmission`:

| Client | Host | Result |
|--------|------|--------|
| `if-idle` | no run, gate free | accept, new run |
| `if-idle` | run active | refuse `active`, no mutation |
| `if-idle` | reserved / cancelling | refuse `transitioning` |
| `replace-run(A)` | run A | reserve, ack new run, cancel A after ack |
| `replace-run(A)` | run B | refuse `changed` |
| `replace-run(A)` | idle | refuse `already-finished` |
| `replace-run(A)` | reserved | refuse `transitioning` |

Validate attachments / context refs / size **before** cancel. Invalid input must not cancel an existing run.

`session/abort` / steer / intervention / pause with a missing or stale `runId` must not affect a newer run.

Queued turns are Host-owned (`session/queued-turn-updated`). After the foreground run is terminal, Host drains the queue. A successful `replace-run` makes the new run the foreground; existing queued turns wait until **that** run is terminal. Adopt-to-intervention keeps existing revision rules.

Terminal reason for the cancelled run: `superseded-by-new-prompt`. UI must not treat it as a crash.

### 4.2 Composer (all shells)

```
knownRun = last session/foreground-run + run/session pushes
key = gestureId  // reuse until this gesture gets a HostResponse

if knownRun == none:
  prompt(if-idle, key)
  on foreground-run-mismatch / active:
    offer queue | replace(actualRun.runId) | dismiss
    each offer is a new key
  on already-finished | changed | transitioning:
    refresh foreground-run; do not auto-retry
else:
  queued-turn-submit(key)
```

Stop / permission / checkpoint controls stay disabled until hydration has the live id.

Optimistic user rows: sender-only, uncommitted, removed on failure. Other shells see the row only from `transcript/append` / queued-turn push.

### 4.3 Attachments, speech, context refs

- `media/save` then prompt by Host asset id. Any authorized shell on this Host may reference a saved asset. Failed save → do not prompt.
- Speech: independent transcribe requests; no shared draft.
- Remote `session/prompt` today fails `isSafeRemoteCommand` when `contextRefs.length > 0`. Target: accept refs that are Host-issued (opaque session/asset/project file id). Desktop must map `@` chips to those ids or flatten to text before send. Do not reject the whole prompt as “command not enabled”.

`run/intervention-submit` stays text-only (existing).

### 4.4 Side chat and child sessions

Each `sessionId` has its own admission gate. Side-chat send does not abort the parent run. `subagent/batch-cancel` names the parent `runId`. `subagent/continue` is a prompt on the child session.

### 4.5 Plan execute vs prompt

`plan/execute` occupies the same foreground run slot as `session/prompt`. Same gate. Existing `expectedRevision` on plan writes stays.

---

## 5. Settings

### 5.1 Current

- `SettingsService.apply` is serialized and compares **whole-document** `expectedRevision` only. Non-overlapping domain writes conflict.
- `settings/apply` is on the Host default allowlist and on the omitted-list fallback. The attached shell is the operator UI.
- No `settings/updated` push. Other shells do not learn of applies.
- `desktop` restore lives in the same document as agent settings (ADR 0048 already excludes it from `runtimeRevision`).

### 5.2 Snapshot / apply contract

Extend `SettingsSnapshot`:

```ts
domainRevisions: { [K in SettingsDomain]?: string };
```

Hash function: SHA-256 of canonical JSON for that domain only (same normalization as `createSettingsSnapshot`). Export from `settings-service.ts`.

`ApplySettingsInput`:

```ts
{
  expectedRevision: string; // required on remote; required for new Desktop/CLI callers
  mutations: SettingsMutation[];
  expectedDomainRevisions: Partial<Record<SettingsDomain, string>>; // required for every mutated domain
}
```

Algorithm (still under `mutationChain`):

1. Load current snapshot.
2. If `expectedRevision === current.revision` → apply mutations, write, push, return.
3. Else, for each mutation, if `current.domainRevisions[domain] !== expectedDomainRevisions[domain]` → collect `conflictingDomains`.
4. If any conflicting → throw; **write nothing**.
5. Else apply mutations onto **current** config (rebase), write, push, return.

```ts
type SettingsRevisionConflictProblem = {
  code: 'settings-revision-conflict';
  data: {
    expectedRevision: string;
    actualRevision: string;
    conflictingDomains: SettingsDomain[];
    snapshot: SettingsSnapshot; // remote: already projected
  };
};
```

`catalog-commands.ts` already maps `SettingsRevisionConflictError` to `settings-revision-conflict`. Attach `problem` on the `HostResponse`.

Hot-apply timing remains ADR 0048: in-flight run keeps its generation; next root run uses the new snapshot.

### 5.3 Host-shared vs device-local

**Device-local:** window layout (sidebar width, locale worn by this window) stays in the shell. It is not a settings domain.

**Host-shared `desktop`:** composer default model / thinking and last-session restore. The attached shell writes these through `settings/apply`.

**Remote `settings/apply`:** every settings domain including `desktop` restore. Raw provider key material is still rejected on the `providers` domain; keys go through `secrets/set`.

The attached shell writes Host files through commands. `permissions.json` stays on the Host disk; `permissions/set-rules` is how the shell changes it. Run Mode is `{ mode, preset }` on the `permissions` settings domain.

Add `settings/apply` to `DEFAULT_ALLOWED_COMMANDS` only after `isSafeRemoteCommand` enforces this domain allowlist and `projectRemoteSettingsData` is applied to the result.

### 5.4 Push

Add `settings/updated`:

```ts
{ type: 'settings/updated'; revision: string; runtimeRevision: string; changedDomains: SettingsDomain[] }
```

Receivers that have settings open refetch `settings/get` (or apply the projected snapshot if included later). Dirty editors keep unsent edits; mark pages in `changedDomains`.

---

## 6. Permissions and extension UI

- One live `requestId`. First `permission/resolve` wins. Second fails (`Unknown permission request` today). Attach `problem.code = 'ticket-consumed'`.
- Fan-out `permission/resolved` already exists; all subscribed shells dismiss the card.
- Remote `rememberScope` remains `'once'` only (hybrid §7.5).
- `extension/ui_resolve` same ticket rules.
- Agent does not wait for a disconnected shell. Existing timeout stays.

---

## 7. Session index

| Command | Primitive | Push (add if missing) |
|---------|-----------|------------------------|
| `session/create` | idempotent create | `session/index-updated` `{ op: 'created', session }` |
| `session/rename` | LWW | existing `session/name-updated` |
| `session/auto-name` | no-op if `nameSource === 'user'` (already) | `session/name-updated` |
| `session/pin` `unpin` | LWW | `session/index-updated` |
| `session/archive` `unarchive` | LWW | `session/index-updated` |
| `session/delete` | body gate; abort run if any; then delete | `session/index-updated` `{ op: 'deleted', sessionId }` |
| `session/duplicate` `session/fork` | idempotent; remote fork/duplicate uses `projectId` only | `created` |
| `session/truncate-from` | body gate; refuse or abort if run live; names `messageId` | transcript + index |
| `session/export` | snapshot at start; no session lock | none required |

Delete vs prompt: same `sessionId` gate. Delete after reserve → later prompt fails unknown session. Prompt after reserve → delete waits for abort or returns `session-busy` until `force` after confirm.

Viewer of a deleted session: on `op: 'deleted'`, leave the transcript, show empty workspace.

`session/index-updated` is new. Until it exists, other shells only notice list changes on refetch — not acceptable for delete/create.

---

## 8. Notes, todos, flashcards

**Notes**

- `NoteUpdateInput` / `notes/delete` add `expectedUpdatedAt: string` or `expectedContentHash: string` (prefer `contentHash` already on `NoteRecord`).
- Mismatch → `notes-revision-conflict` + current `NoteRecord`. Serialize writes per `noteId`.
- `notes/write` (create) is idempotent by caller key; two creates = two notes unless same key.
- `notes/reindex`: exclusive process job.

**Todos**

- `todo/set` adds `expectedRevision` (hash of current items). Mismatch → `todo-revision-conflict` + current items. `todo/updated` already fans out.

**Flashcards**

- `flashcards/rate` is serialized per `cardId`. Last applied rate wins scheduling. Both shells refetch queue from Host. No client-side SM-2.

---

## 9. Long jobs

| Job | Exclusive key | Second caller | Interaction with prompt |
|-----|---------------|---------------|-------------------------|
| `session/compact` | `sessionId` | busy / status | refuse if run live; or abort-then-compact behind confirm |
| cold-storage execute/restore | process | busy | refuse pack of a live run; packed session cannot prompt/duplicate/export (existing body-unavailable) |
| `walkthrough/generate` | `(sessionId, messageId)` | join in-flight or return existing unless `force` | none |
| doccards index/generate | folder | progress already pushed | n/a |
| `job/start` | idempotency key | same key = same job | n/a |
| `cron/upsert` | `jobId` | last write or CAS | trigger is Host clock, not a connected shell |

---

## 10. Files, Git, PTY, browser

- Remote clients never send Host absolute paths. Scope is `projectId` + Host-relative path.
- `project/open` `project/trust` remain Host-machine only.
- File conflicts from tools stay Git / subagent integration (ADR 0030). No file-level CAS for shells.
- PTY stays local (ADR 0013) until a remote PTY ADR.
- Browser lock (`idle` \| `user` \| `agent`) is the mutex if remote browser is ever allowlisted. Do not allowlist in this document.

---

## 11. Hydration and egress

On hello / replay-too-old, before the shell enables mutation controls:

- capabilities + `hostInstanceId`
- paged session index
- subscribed session transcript tail
- foreground run (`runId`, status, phase)
- pending permissions and extension UI
- queued turns + pending interventions
- checkpoints
- settings `revision` (not full secrets)

`hostInstanceId` change → drop cursor, full hydrate. Do not stitch seq spaces.

Unsubscribed sessions: no full transcript. Index, inbox-class events, and
`session-turn` Run lifecycle projections still arrive. `run/updated` and
`run/terminal` for these turns are global so background sidebar working and
completion indicators update without reopening the session. Internal
plan/subagent Runs and message/tool streams remain session-scoped.

Clients that advertise `liveSubscriptions` receive high-rate session pushes
only for a bounded subscribed set (default: the active session; maximum eight
ids, matching one Desktop Conversation pane workspace). Global and inbox pushes always pass. `throughSeq` still advances across
filtered records. Clients that omit the capability keep full fan-out.

Minimum compatible shell: any client that sends `client/subscriptions` must
speak protocol v1 with `liveSubscriptions: true`. Older shells keep working
until that capability is retired.

A slow client’s push queue is bounded (ADR 0038). Agent execution does not wait on client liveness. Disconnecting a slow consumer does not stop the Run or other shells.

Composer drafts, scroll position, and open panel are not Host state.

---

## 12. Client copy (stable keys, not protocol strings)

| `problem.code` + detail | Copy key | Actions |
|-------------------------|----------|---------|
| `foreground-run-mismatch` / `active` | `run.busyOtherClient` | queue / replace / dismiss |
| `foreground-run-mismatch` / `changed` | `run.changedOtherClient` | refresh / replace new id / dismiss |
| `foreground-run-mismatch` / `already-finished` | `run.alreadyFinished` | send if-idle |
| `foreground-run-mismatch` / `transitioning` | `run.transitioning` | wait |
| `superseded-by-new-prompt` (terminal) | `run.supersededByOtherClient` | none (status) |
| `settings-revision-conflict` | `settings.domainConflict` | reload conflicting domains / overwrite (new apply) |
| `ticket-consumed` | `permission.alreadyResolved` | dismiss |
| `notes-revision-conflict` | `notes.conflict` | reload / overwrite |
| `todo-revision-conflict` | `todo.conflict` | reload / overwrite |
| `session-busy` | `session.bodyBusy` | wait / force where allowed |
| `idempotency-conflict` | `request.duplicateKey` | developer-facing; do not retry blindly |
| `idempotency-key-required` | `request.keyRequired` | caller must own a gesture key |
| `idempotency-registry-capacity` | `request.registryFull` | wait / do not mint a new key by eviction |

Desktop locale files own the strings. CLI prints the same keys’ English fallback.

---

## 13. Protocol / file checklist

| Change | Package / file |
|--------|----------------|
| `SettingsSnapshot.domainRevisions`, apply rebase, typed problem | `packages/contracts/src/settings.ts`, `host-problem.ts`, `settings-service.ts`, `catalog-commands.ts` |
| Remote apply allowlist + `settings/apply` on default remote list | `host-server.ts`, `remote-projection.ts` |
| `settings/updated` push | `packages/contracts/src/ipc.ts`, host-runtime apply path, Desktop `SettingsPanel` |
| `session/index-updated` | contracts + session product commands + Desktop sidebar |
| Note / todo CAS | `packages/contracts/src/notes.ts`, notes store, `todo/set` handler |
| `ticket-consumed` | `resolve-commands.ts` |
| Require remote mutation `idempotencyKey` | `host-server.ts`, `host-client.ts`, Desktop send/apply/delete/resolve |
| Composer queue vs replace | `apps/desktop` composer + `use-session-actions` / `use-composer-media` |
| Safe remote context refs | `isSafeRemoteCommand`, Desktop `@` mapping |
| Data-root lock | `apps/host`, sidecar boot, Desktop connect wall |
| CLI attach | `apps/cli` — later slice, same admission |

Do not merge `feat/standalone-host-multi-client-continuity` or `feat/browser-host-token-admission`.

---

## 14. Delivery slices

Hard order. A slice is done only when its tests in §15 pass.

### S0 — Single process per data root

Lock file + refuse second boot + connect-wall copy. Tests: two `HostServer` on one temp root, second fails.

### S1 — Idempotency keys are caller-owned

Remote mutation without key fails. Desktop prompt/queue/replace/abort/permission/settings/delete pass a gesture key. Retry of the same gesture reuses it. Tests: double `request` with same key → one run; timeout retry fixture.

### S2 — Settings rebase + remote apply + push

Domain hashes, rebase algorithm, `settings-revision-conflict` problem, remote domain allowlist, `settings/updated`. Tests: overlapping domain conflict; non-overlapping rebase success; remote apply of `desktop` / secrets rejected; second client sees push.

### S3 — Composer admission UX

Idle prompt / busy queue / mismatch dialog. Tests: two-client if-idle (one run); busy Enter enqueues; replace names `runId`; invalid attachments do not cancel.

### S4 — Session index fan-out + delete/truncate vs gate

`session/index-updated`; delete/truncate serialized with prompt. Tests: viewer leaves on delete; delete vs in-flight prompt; truncate refused while running unless abort path.

### S5 — Notes + todos CAS

Tests: stale note update fails; two notes independent; stale todo set fails; `todo/updated` on other client.

### S6 — Context refs

Safe ref projection or flatten. Test: remote prompt with projected ref succeeds; raw Host path ref fails without killing a live run.

### S7 — CLI attach (after S1–S3)

CLI uses HostClient WebSocket + same foreground field. No second `HostRuntime` when an endpoint is configured.

Pairing-scoped principals, crash-durable idempotency, remote PTY/browser/git, per-device capability ceilings: not in these slices.

---

## 15. Acceptance tests (automated)

Two `HostClient`s, one `HostServer`, one temp `piwinRoot`.

1. Both subscribe to session A; client-1 prompts; client-2 receives `transcript/append` and the same `runId`.
2. Client-2 `if-idle` during that run → `foreground-run-mismatch` / `active`; no second run.
3. Client-2 `queued-turn-submit` → one `session/queued-turn-updated`; after run terminal, exactly one follow-on run.
4. Concurrent `if-idle` on idle session → one run, one mismatch.
5. Concurrent `replace-run` for the same `runId` → one new run; loser `changed` or `transitioning`.
6. `replace-run` for the wrong `runId` → no cancel of the live run.
7. Settings: client-1 applies `thinking`, client-2 applies `web` from the same base revision → both succeed; revisions rebase; both get `settings/updated`.
8. Settings: both apply `thinking` from the same base → second `settings-revision-conflict` with `conflictingDomains: ['thinking']`.
9. Remote apply of `desktop` or secret-bearing provider mutation → denied; document unchanged.
10. Concurrent `permission/resolve` allow+deny → one decision, both receive `permission/resolved`, second command `ticket-consumed`.
11. Rename + pin from different clients → both visible via pushes; no error.
12. Delete on client-1 while client-2 is viewing → client-2 gets `index-updated` deleted and leaves the session.
13. Same `idempotencyKey` prompt twice → one user message, one run.
14. After `hostInstanceId` change, old key is not replayed; client hydrates.
15. Second Host process on the same root fails the lock (S0).
16. Compact (or pack) in progress → prompt returns `session-busy`.
17. Child-session prompt does not abort parent run.

`pnpm typecheck` and the touched-package tests stay green.

---

## 16. Non-goals (explicit)

- Device/session lease or kicking a shell to read-only
- Three-way merge of settings/notes/todo text
- Syncing composer drafts
- Presence as a correctness signal
- Persisting idempotency across process restart
- Remote PTY, remote secret editors, remote `project/open` of a client path
- Allowlisting `git/*`, `pty/*`, `browser/*` in this work
