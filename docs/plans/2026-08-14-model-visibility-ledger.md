# Piwin Model Visibility Ledger — 修订交付计划

| Field | Value |
|-------|-------|
| Status | M1 implemented on main — WP1–WP3 |
| Date | 2026-08-14 |
| Replaces | Codex `model-visibility-ledger-plan.md` v1.0.0 over-promise |
| Related | ADR 0036 (Host-first / remote projection), ADR 0040 (product transcript), ADR 0033 (MCP outside permission layer), ADR 0043 (`streamSimple` / `onPayload`) |

This document is the implementation authority for the MVL epic. It does **not**
claim that M1 already knows what the model saw.

---

## 0. Decision

Ship **honest assembly transparency** first. Observe the **canonical payload
object** when a real hook exists. Turn **fail-closed** on only after request
classes, ACK, and storage maintenance are specified. Never tell the user
“Verified / 模型实际看到” from assembly-only data.

```text
Product Transcript   → 用户看见的历史（ADR 0040）
MVL                  → 模型请求审计 + model-replay projection
Native checkpoint    → Pi assistant/tool 原生恢复
```

These three authorities do not replace each other.

---

## 1. What this epic is for

Users cannot answer: **this turn, what was assembled, and (later) what payload
was observed leaving Piwin?** That is a product and a debug problem.

MVL is not an M1 “audit theater.” It is three independently shippable products:

| Milestone | User-visible name | Truth it is allowed to claim |
|-----------|-------------------|------------------------------|
| **M1** | Assembly Transparency | 本轮 Host 装配了什么（估算） |
| **M2** | Observed Payload Audit | 在已支持的 hook 上看到的语义 payload（canonical） |
| **M3** | Strict Ledger + Lifecycle | 已支持 request class 上 Model-visible means logged |

A later Scanner / injection-defense feature may consume this data. It is not
in this epic.

---

## 2. Hard rules (revised)

### 2.1 Coverage is first-class

Every summary, drawer, CLI row, and ledger header carries exactly one:

```ts
export type ModelContextCoverage =
  | 'assembly-only'       // M1: Host 装配层，未观察 provider payload
  | 'payload-observed'    // 捕获到序列化前的 observed payload object
  | 'canonical-verified'  // canonicalize(reconstructed) === canonicalize(observed)
  | 'capture-missed'      // 本该观察，持久化或 hook 失败
  | 'unsupported'         // 该 request class / provider 没有观察接缝
  | 'redacted'            // 调用方只拿到脱敏投影
  | 'unknown';            // 必须带 reason；进指标，禁止当长期垃圾桶
```

`unknown` and contribution `other` **must** carry `reason` + `rawKind` and
increment a metric. They are not a silent default.

**M1 UI and `ContextSummaryPush` default to `assembly-only`.** Database
`coverage` must not default to `complete`. There is no `complete` / `Verified`
state in M1.

Forbidden in M1 copy:

- 「模型实际看到」
- 「Verified」/ 账本已校验
- Raw Request / 原始请求审计
- 精确 Token 占比条（没有真实分母时）

Required M1 copy:

- 「本轮装配内容」
- Token：「约 N tokens（估算）」
- 若稍后有 Pi/provider usage：「模型实际输入：N tokens（reported）」

### 2.2 Canonical ≠ wire

`streamSimple` / `onPayload` (ADR 0043) can capture the **pre-serialization
payload object** on registrations that actually wrap that hook. That is
**semantic observation**, not HTTP bytes.

| Claim | Allowed when |
|-------|----------------|
| `payload-observed` | Hook returned an object and it was persisted |
| `canonical-payload-verified` | `canonicalize(reconstruct(events)) === canonicalize(observed)` |
| `wire-exact` | **Out of this epic.** Only if a later design intercepts serialized bytes |

Provider SDKs may still add default fields, headers, and stream framing after
`onPayload`. Codecs are versioned with the Pi / provider adapter. Round-trip
acceptance is **canonical JSON equality**, never network-byte equality.

### 2.3 Observation inventory before “we can see the final payload”

`onPayload` today is the **native-search rewrite seam**, not a universal
provider observer. M2 starts with a written inventory:

| Request class | Hook exists today? | M2 action |
|---------------|--------------------|-----------|
| Foreground `session/prompt` (SDK) | TBD per provider registration | observe or `unsupported` |
| Same, RPC worker | TBD; payload may need a worker→parent channel | observe or `unsupported` |
| Tool-loop continuation | TBD | same |
| `session/steer` / `follow_up` | TBD | same |
| Compaction completion | TBD | same |
| Vision delegate | TBD | same |
| Native search delegate | Yes (`onPayload`) | observe |
| Subagent prompt | TBD | same |
| Side-chat sync / inherited snapshot | Assembly only unless a later request fires | assembly-only |
| Session auto-name / other lightweight completions | TBD | usually `unsupported` in M2 |

No hook ⇒ `unsupported` or `capture-missed`. Do not imply SDK/RPC always see
the final payload.

### 2.4 Gates are staged, not abandoned

**Model-visible means logged** remains the *mature* invariant. It is not M1/M2
acceptance.

| Phase | Gate |
|-------|------|
| M1 | No dispatch gate. Persist assembly best-effort. Failure → `capture-missed` / keep `assembly-only`. Ordinary user-transcript write failure stays **warn** unless a separate product decision changes it. |
| M2 | Best-effort observe + persist. Failure → `capture-missed` / `partial`. Network still goes out. |
| M3 | For **listed supported request classes only**: persist ACK (or equivalent) before network. Failure → fail-closed that request. Unsupported classes stay best-effort. |

M3 is blocked until these are written (not in M1):

- RPC large-payload / image transfer budget
- SQLite commit latency budget
- ACK loss / retry / idempotency
- SQLite busy / disk-jitter policy
- The request-class list above, with owners

### 2.5 Three authorities

| Authority | Owns | Must not own |
|-----------|------|----------------|
| Product Transcript | User/assistant/tool cards, search, export of *conversation* | Provider payload, “what the model saw” |
| MVL | Assembly contributions, observed payloads, coverage, model-replay projection | Replacing chat history |
| Native checkpoint | Pi assistant/tool restore | Product UX history |

Cold activation continues to use Product Transcript for bounded product-history.
MVL may later *project* a historical model request; it does not become the
resume pipeline.

---

## 3. Storage

### 3.1 Independent DB

Per session directory (same folder as `transcript.sqlite3`):

```text
~/.piwin/sessions/<sessionId>/
  transcript.sqlite3          # ADR 0040 product authority
  model-context.sqlite3       # MVL authority
```

A **Session Maintenance Service** (extend the existing session maintenance /
lease paths; do not invent a second orphan sweeper) coordinates:

- create / open both DBs
- fork / duplicate / truncate / delete / export
- doctor: detect missing MVL file, schema version, `coverage` vs events
- GC: **mark-and-sweep** blobs reachable from events + checkpoints in *this*
  session file. No cross-session blob sharing in v1, so fork copies the MVL
  file (or copies reachable blobs + events). Deleting session A cannot break
  session B.

Putting MVL tables inside `transcript.sqlite3` is allowed only with a **new
ADR** that updates doctor, migration, fork, export, truncate, and rebuild.
That is not the default.

### 3.2 Schema (indicative)

Keep three table families, but `coverage` defaults to `assembly-only`:

```sql
CREATE TABLE model_context_meta (
  session_id TEXT PRIMARY KEY,
  format_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  coverage TEXT NOT NULL DEFAULT 'assembly-only',
  updated_at TEXT NOT NULL
);

CREATE TABLE model_context_blob (
  digest TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'identity',
  byte_length INTEGER NOT NULL,
  body BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE model_context_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  run_id TEXT,
  runtime_generation_id TEXT,
  request_class TEXT,
  request_ordinal INTEGER,
  idempotency_key TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

M1 的账本格式版本 2 还包含显式 Blob 引用表，并使用增量回收：

```sql
PRAGMA auto_vacuum = INCREMENTAL;

CREATE TABLE model_context_event_blob (
  event_seq INTEGER NOT NULL,
  blob_digest TEXT NOT NULL,
  PRIMARY KEY (event_seq, blob_digest)
);
CREATE INDEX idx_mcl_blob_ref ON model_context_event_blob(blob_digest);
```

事件引用必须通过 `blobDigests` 写入；装配摘要则从贡献项的
`contentRef.digest` 写入。旧版本数据库首次打开时会完成 auto-vacuum 和
历史 payload 引用迁移，`pruneUnreferencedBlobs()` / `truncateEventsFrom()`
在同一事务中清理引用与孤儿 Blob。

Duplicate 复制完整账本；Fork 复制所选 transcript 边界内的事件，并保留
event id、幂等键、时间戳、Blob 及显式引用。复制后的新请求会从目标账本中
恢复 `requestOrdinal`，不会因 Host 重启或会话派生而回到 1。
```

Blob `encoding` in M1 is `identity` only. `zstd` is M3+ and needs a dependency
ADR.

### 3.3 Event types that must exist in contracts (not just UI push)

```ts
type ModelContextEventType =
  | 'generation/open'
  | 'turn/input'              // authored assembly contributions
  | 'surface/checkpoint'
  | 'surface/append'
  | 'surface/replace'
  | 'request/header'
  | 'request/dispatch'        // observed payload ref + digest
  | 'capture/missed'
  | 'replay/checkpoint';
```

Each event payload is a versioned object in `@piwin/contracts`. M1 implements
`turn/input` + `generation/open` + `capture/missed`. M2 adds `request/*` and
surface events for supported classes.

---

## 4. Identity

Every model request, push, and drawer row is keyed by:

```ts
type ModelRequestIdentity = {
  sessionId: string;
  runtimeGenerationId?: string;
  runId?: string;
  requestClass: ModelRequestClass;
  requestOrdinal: number; // monotonic per (session, generation or run) — pick one and test it
};

type ModelRequestClass =
  | 'prompt'
  | 'tool-loop'
  | 'steer'
  | 'follow-up'
  | 'pause-resume'
  | 'compaction'
  | 'vision-delegate'
  | 'search-delegate'
  | 'subagent'
  | 'side-chat-sync'
  | 'other'; // requires reason
```

How each class is recorded:

| Class | M1 | M2 | Notes |
|-------|----|----|-------|
| `prompt` | assembly `turn/input` + summary push | observe if hook | User send, replace-run, if-idle |
| `tool-loop` | optional “+N tool 结果将进入下一跳” without claiming model-visible | observe next request | Must not jitter the pill into a growing stack |
| `steer` / `follow-up` | assembly of the steer text + inherited coverage | observe if hook | Same run, new `requestOrdinal` |
| `pause-resume` | new Run; assembly like prompt | same | Resume is a new request, not a silent splice |
| `compaction` | do not fake a user pill | observe or `unsupported` | Internal completion |
| `vision-delegate` / `search-delegate` | mark contribution kind | search has `onPayload` | Vision may be `unsupported` at first |
| `subagent` | child session has its own MVL file | same | Parent pill may show a child ref, not dump child payload |
| `side-chat-sync` | assembly of snapshot/refs | only if a model request fires | |

---

## 5. Contracts and Host-first projection

### 5.1 Assembly summary push (M1)

```ts
export type ContextSummaryPush = {
  type: 'agent/context-summary';
  sessionId: string;
  runId: string;
  requestClass: ModelRequestClass;
  requestOrdinal: number;
  coverage: 'assembly-only' | 'capture-missed' | 'redacted';
  totalEstimatedTokens?: number;
  estimateSource: 'host-estimate';
  reportedPromptTokens?: number; // from existing usage contract, if any
  usageSource?: 'pi-contextUsage' | 'assistant-usage' | 'host-estimate';
  contributions: Array<{
    id: string;
    kind: ModelContextContributionKind;
    label: string;
    trustOrigin: ModelContextTrustOrigin;
    estimatedTokens?: number;
    resourceRef?: string;
    displayPath?: string;
    canOpenOnClient: boolean;
    redactionState: 'none' | 'path' | 'body' | 'full';
  }>;
};
```

No Host absolute paths. No raw system prompt. No tool schema. No blob bodies.

Also required in the same slice as the push (not “later if we remember”):

- `HostPush` variant + classifier (control vs data)
- replay / hydration inclusion rules
- subscription scope (session / run)
- backpressure (bounded; drop or snapshot, never unbounded queues)
- capability flag e.g. `contextSummary: true`
- HostServer remote projection (always redacted)

### 5.2 Raw / reconstructed payload (M2+)

- **Never** on ordinary `HostPush`
- Not in export, Walkthrough, or share by default
- Read via an explicit Host command, e.g. `session/model-context-request`,
  authorized per device ceiling (remote default deny)
- Audit the read
- Distinguish **ledger original** vs **UI redacted view**
- MCP / tool / web bodies are untrusted input (ADR 0033): show origin and
  redaction, not a yellow badge as the only control

### 5.3 Contribution kinds

Keep the v1 kind union, but:

- `other` requires `reason` + `rawKind`
- `source.path` is Host-internal only; wire uses `displayPath` / `resourceRef`
- Token fields are optional estimates until usage is attached

---

## 6. Assembly collection (M1 truth)

Do not rename `preparePromptInput` and call it done. Collect contributions at
each real inject site:

```text
buildModelPromptInput
  → attachment text
  → native image / vision delegate / path fallback
preparePromptInput
  → side-chat snapshot + refs
  → context refs
  → agent mode
  → orchestration
  → active plan
  → files touched
activate / first prompt on a generation
  → product-history
Pi ResourceLoader (observe labels only in M1 if text is not Host-owned)
  → system / AGENTS / Skills / Extensions   → often assembly-only + “Pi-owned”
Pi / provider (M2)
  → history / tools / thinking / native search
```

Golden tests:

- **M1:** contribution set + estimated tokens + prompt *text* where Host owns it
- **Not M1:** images, tool definitions, system blob, provider options
- Changing user-transcript write-from-warn-to-fail is a **separate product
  decision**, not a refactor side effect

---

## 7. UI (Desktop M1 only)

`@piwin/ui-kit` has **no Storybook**. Do not put Storybook in the test matrix
until a later ADR adds it.

### M1 deliverable

One **assembly summary capsule** under the user bubble (single layout rule:
user message bottom edge, not also above the assistant card).

- States: `preparing` → `assembly-only` | `capture-missed`
- Body: `本轮装配 · 约 4.2k tokens（估算） · 规则 · @auth.ts · Plan`
- Click: **simple detail panel** (inline or a small drawer): list of
  contributions with label, trust origin, estimate, optional snippet if
  already Host-owned and not redacted
- External / MCP: origin + `untrusted` + redaction state; no raw dump
- `runtime-updated`: replace the capsule subtitle (`+ tool 结果将进入下一跳`),
  do **not** append N growing rows that reflow the thread
- `canOpenOnClient === false` (remote Host): no “在编辑器打开”

No Tab 3. No digest badge. No composition bar unless
`usageSource` is `pi-contextUsage` or `assistant-usage` **and** a real
denominator exists. Until then, show two lines:

```text
注入文本：约 4.2k tokens（估算）
模型实际输入：18,432 tokens（reported）   // omit if unknown
图片：未知 / provider-accounted
```

M2 drawer may add “观察摘要 / canonical digest（非 wire）”.
M3 may add authorized raw view.

Components in M1: `ContextInjectionPill` + a small `AssemblyDetailList`.
Do not land seven inspector files up front.

---

## 8. Work packages

### M1 — Assembly Transparency (mergeable)

- **WP1** Contracts: coverage, identity, `turn/input`, `capture/missed`,
  `ContextSummaryPush` with `coverage` + remote-safe fields. SQLite MVL file +
  store (`putBlob`, `appendEvent`, tx). Doctor sees the file.
- **WP2** Collect contributions at the inject sites in §6 (Host-owned only).
  Push summary after assembly. Failures → `capture-missed`, prompt still sends.
- **WP3** Desktop capsule + simple detail. CLI: `piwin context <sessionId>`
  prints the same assembly summary (no raw). Capability + remote projection
  stubs so a second client does not get paths.

**M1 DoD**

- [x] Desktop shows “本轮装配” capsule with estimates, never Verified / Raw
- [x] Detail lists Host-owned contributions without Host absolute paths
- [x] `coverage` persisted as `assembly-only` or `capture-missed`
- [x] Second client / remote projection cannot see `~/.piwin` paths
- [x] Prompt still sends if MVL write fails (warn + coverage)
- [x] Unit tests for store + contribution collection; no 50ms wall-clock UI test
- [x] User-transcript persist semantics unchanged

### M2 — Observed Payload Audit

- **WP4** Observation inventory (§2.3). Implement observe only where a hook
  exists. Versioned `canonicalize` for *observed objects*, not HTTP.
- **WP5** Persist `request/dispatch` + `capture/missed`. No fail-closed.
- **WP6** Desktop: show `payload-observed` / `canonical-verified` /
  `unsupported` on the same capsule. Authorized command to fetch redacted
  observed summary. Still no default raw dump.

**M2 DoD**

- [ ] Inventory checked in (table in this doc or `docs/adr/` successor)
- [ ] Native-search path at least `payload-observed` when wrap is active
- [ ] Classes without hooks are `unsupported`, not fake-verified
- [ ] Canonical verify uses object canonicalize, never “bit-exact”
- [ ] Raw payload not on `HostPush`

### M3 — Strict Ledger + Lifecycle

- **WP7** Model-replay *projection* from MVL for inspectors; cold chat resume
  still Product Transcript
- **WP8** Fork / duplicate / truncate / compaction / delete via Session
  Maintenance; mark-and-sweep GC; `replay/checkpoint`
- **WP9** Strict gate for **supported** request classes; env
  `PIWIN_MODEL_VISIBILITY_STRICT=1` per class; CLI parity

**M3 DoD**

- [ ] ACK / busy / payload-size design accepted (short ADR)
- [ ] Supported classes fail-closed on persist miss
- [ ] Unsupported classes unchanged (best-effort)
- [ ] Lifecycle ops keep MVL consistent with the session file
- [ ] Export/share default excludes ledger originals

Epic-level DoD (not used to merge M1): M1+M2+M3 all green.

---

## 9. Tests (honest)

| Layer | Assert |
|-------|--------|
| Store | Blob dedup, tx rollback, coverage default `assembly-only` |
| Assembly | Known inject sites emit contributions; Host-owned text golden where applicable |
| Push | Shape + no absolute paths; capability / projection |
| Observe (M2) | Inventory cases; native-search `onPayload` object persisted |
| Canonical (M2) | `canonicalize` stable for fixtures; not HTTP bytes |
| Gate (M3) | Supported class + persist fail ⇒ zero provider calls; unsupported class still sends |
| Lifecycle (M3) | Fork copy; delete GC; doctor missing file |
| UI | Component tests in ui-kit/Desktop; **no** Storybook, **no** 50ms SLA |

---

## 10. Non-goals (this epic)

- Wire-exact / packet capture
- Prompt-injection scanner
- Stuffing payloads into product transcript message metadata
- Storybook as a merge gate
- Changing user-transcript write-fail from warn to reject without its own decision
- Remote clients receiving raw system / tools / files
- Replacing ADR 0040 cold history with MVL

---

## 11. Suggested first implementation slice

Do **M1 WP1–WP3** only. Stop when the M1 DoD is true. Do not open WP4 codecs
or fail-closed in the same plan execution.
