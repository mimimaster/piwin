# P6 Main-Path Completion — Executable Plan

| Field | Value |
|-------|-------|
| Status | **Executed 2026-07-20** — M1–M5 main path complete; residuals in todo-deferred |
| Date | 2026-07-20 |
| Goal | Finish the remaining **main-path** P6 work so Desktop + CLI primary flows are complete, secure enough for private v1 use, and release-checkable |
| Canonical backlog | [`docs/todo-deferred.md`](../todo-deferred.md) |
| Roadmap | [`docs/specs/v1-completion-roadmap.md`](../specs/v1-completion-roadmap.md) §10 |
| Binding rules | `AGENTS.md` (host boundary, contracts-first, no Pi in apps) |

---

## 0. Scope definition

### 0.1 What “main path” means here

A private user can:

1. Open project → trust → create/resume session → chat with tools.
2. Attach images (paste/drop/picker); history + attachments survive process restart.
3. Use Skills / MCP with visible health and controlled start/stop.
4. Gate bash + network; remember network allows per project.
5. See Git / Theme / Pet product surfaces.
6. Run `pnpm install && pnpm typecheck && pnpm test` and `piwin doctor` cleanly.
7. Ship a **repeatable** desktop build path (even if store signing is later).

### 0.2 In scope (this plan)

| Track | Backlog IDs | Why main path |
|-------|-------------|---------------|
| **M1** MCP host completeness | D-MCP-02b, D-MCP-04, (light 02d) | tools must be reliable after lifecycle landed |
| **M2** Session/host parity | D-M2-01b (bounded), D-M2-02 (light), D-HOST-01 (bounded) | resume + list must feel real |
| **M3** Secrets + providers | D-M2-04, D-HOST-02 | without this, “works on my machine only” |
| **M4** Quality gates | D-M2-05, D-ENG-02 (light), doctor gaps | exit criteria for “done enough” |
| **M5** Release path | D-ENG-03 (unsigned package OK) | can produce installable artifact |

### 0.3 Explicitly out of this plan (stay in todo-deferred)

Do **not** pull these into main-path execution unless a slice fails without them:

| Keep deferred | IDs |
|---------------|-----|
| Artifact polish bulk | D-ART-05..08 |
| Git DAG / force-push / auto-inject | D-GIT-02..04 |
| MCP SSE/HTTP, auto-restart watchdog | D-MCP-05, D-MCP-02c |
| Sub-agent / plan / compaction UI | D-HOST-03, D-HOST-04 |
| Pet/theme content polish | D-PET-01, D-THEME-01 |
| Thumbnail cache, host-log panel, mock hot-switch | D-MED-04, D-M2-06, D-M2-07 |
| Never silent | X-01..X-04, D-GIT-04 |

If a slice discovers new intentional skips, **add residual IDs** to `todo-deferred.md` (rule §4).

---

## 1. Current baseline (do not re-architect)

Already shipped (evidence in backlog Done archive):

- Dual host skeleton; SDK path usable; product transcript resume.
- Media IPC, web tools + SSRF + project remember, bash gate.
- Skills/MCP config + form + lifecycle manager (status/start/stop).
- Artifact core+polish; Git read/write; Theme; Pet.
- CI typecheck/test; expanded `doctor`.

Hard constraints for all tracks:

1. Only `@piwin/agent-host` may import Pi.
2. Contracts first for new IPC / cross-package types.
3. `exactOptionalPropertyTypes` + no `any` / silent catch.
4. Prefer adapters over forks of Pi.

---

## 2. Execution order (dependency-driven)

```text
M1 MCP completeness (02b → 04 → light 02d)
  → M2 Session/host parity (02 light UI → 01b spike → HOST-01 bounded)
  → M3 Secrets + providers (HOST-02 → M2-04)
  → M4 Quality (doctor matrix → E2E smoke → ENG-02 light)
  → M5 Release path (unsigned package + runbook)
```

Rationale:

- MCP must be single-owner process model before more adapter work (avoids double stdio).
- Session UI can land without full Pi tree; tree projection is a **spike then decide**.
- Secrets before release packaging.
- E2E last so it covers the fixed surfaces.

**Session split (recommended):**

| Session | Tracks | Ship gate |
|---------|--------|-----------|
| S1 | M1 | MCP manager shared; optional SDK client behind adapter |
| S2 | M2 | session list/tree light + resume story documented |
| S3 | M3 | no plaintext keys in config UI; provider validation |
| S4 | M4+M5 | E2E smoke green; `pnpm package:desktop` (or documented cargo/tauri build) |

---

## 3. Track M1 — MCP main-path completeness

### Goal

One process model for MCP: HostRuntime lifecycle manager is the source of truth for Desktop **and** SDK session tools.

### M1.1 D-MCP-02b — Pass lifecycle manager into session bridge

| Layer | Work |
|-------|------|
| agent-host | Own a process-scoped (or HostRuntime-scoped) `McpLifecycleManager`; pass `lifecycleManager` into `createMcpSessionBridge` from SDK createSession path used by HostRuntime. |
| agent-host | If only bare `createAgentHost` is used (CLI chat), either: (a) create a short-lived manager per host instance, or (b) document CLI degradation and keep per-session connect — prefer (a) for consistency. |
| tests | Fixture: start server via manager → create session tools → `listTools` reuses same pid; dispose host stops process. |

**Files (expected):**

- `packages/agent-host/src/create-host.ts`
- `packages/agent-host/src/sdk-adapter.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/mcp-session-bridge.ts`
- tests colocated

**Exit M1.1:** no double-spawn of the same server id for UI start + session tools in one host process.

### M1.2 D-MCP-04 — Official SDK client behind adapter

| Layer | Work |
|-------|------|
| contracts | No change unless transport kinds expand (keep stdio only here). |
| mcp | Introduce `McpTransportClient` interface matching current `McpClientSession` (`listTools` / `callTool` / `close` / optional `pid`). |
| mcp | Implement `OfficialMcpStdioClient` using `@modelcontextprotocol/sdk` **if** dependency resolves cleanly; keep `HandcraftedJsonRpcStdioClient` as fallback. |
| mcp | Feature flag / factory: `createMcpClient(config) → prefer official, catch → handcrafted + warning`. |
| lifecycle | Manager depends only on interface. |
| tests | Unit against mock transport; optional integration with fixture server if exists. |
| docs | Update ADR 0008 consequences: dual implementation temporary; handcrafted retained until official proven. |

**Exit M1.2:** default path uses official SDK when available; handcrafted still green in CI without network.

**Residual if official SDK too heavy:** mark D-MCP-04 as “spike failed, stay handcrafted” with ADR note — do not block M2.

### M1.3 D-MCP-02d (light) — Project-remember for MCP connect

| Layer | Work |
|-------|------|
| project | Extend `ProjectNetworkPolicy` **or** add `ProjectMcpPolicy` with `allowedServerIds: string[]` (prefer separate field to avoid overloading “network”). |
| host | On `mcp:connect` allow + `rememberScope: 'project'`, persist server id. |
| session-tools / bridge | Skip connect prompt when server id remembered for project. |
| desktop | Permission modal already has “Allow for project”; ensure action `mcp:connect` enables the button (already network-prefixed pattern — extend to `mcp:`). |

**Exit M1.3:** second session in same project does not re-prompt for the same MCP server connect (tool-call may still ask unless separately remembered — document residual D-MCP-02d-tool if skipped).

### M1 acceptance checklist

- [ ] Desktop Start server → session tools see same server without second spawn
- [ ] Stop server → subsequent tool call fails clearly or reconnects via Start
- [ ] Host dispose kills MCP children
- [ ] typecheck + mcp + agent-host tests green

---

## 4. Track M2 — Session / host main path

### Goal

User-facing resume is trustworthy; tree is **usable**, not necessarily full Pi DAG.

### M2.1 D-M2-02 — Session tree UI (light)

Product choice (locked for this plan):

- **Linear transcript is source of truth for chat body** (already).
- “Tree UI” = **session list + optional message outline**, not full Pi branch graph.

| Layer | Work |
|-------|------|
| contracts | Optional: `SessionOutlineNode { id, role, preview, createdAt }` derived from transcript. |
| session | `buildSessionOutline(messages)` pure function. |
| host | `session/outline` **or** include outline in `session/resume` payload (prefer extend resume to avoid chatty IPC). |
| desktop | Left session list: show `lastPreview`, messageCount, updatedAt (from index). |
| desktop | Optional right/top outline: jump-scroll to message id in chat. |
| tests | outline pure tests; resume still hydrates attachments. |

**Exit M2.1:** resume shows history; session list is informative; no fake multi-branch UI.

**Residual:** full multi-leaf Pi tree → keep **D-M2-01b** / **D-M2-02-full** if introduced.

### M2.2 D-M2-01b — Pi JSONL resume spike (time-boxed)

| Step | Work |
|------|------|
| Spike (½–1 day) | Document what Pi 0.80.10 actually restores via SessionManager / session file path. |
| Decision | A) product shell only (status quo) B) wire `piSessionFile` into create/resume when available C) defer |
| If B | store `piSessionFile` on session index when Pi provides it; resume prefers Pi file then falls back to product shell. |
| ADR | Short ADR 0009 if behavior changes dual-mode resume semantics. |

**Exit M2.2:** written decision in ADR or backlog residual; no half-broken “looks resumed but wrong model state”.

### M2.3 D-HOST-01 — RPC adapter bounded parity

Not full RPC protocol rewrite. Minimum for main path:

| Work | Detail |
|------|--------|
| RPC create/resume | Same product transcript path as SDK (HostRuntime already owns transcript). |
| Explicit capability | Host status / doctor reports `rpc.customTools: false` (already ADR 0008). |
| CLI | `piwin chat --mode rpc` either works for plain chat or fails with clear message; never silent mock. |
| tests | mock RPC host still typechecks; capability flag unit test. |

**Exit M2.3:** RPC not oversold; SDK remains default main path.

### M2 acceptance checklist

- [ ] Resume after process kill shows prior messages + images
- [ ] Session list shows previews
- [ ] Doctor/status honest about RPC tool limits
- [ ] Spike decision recorded for Pi JSONL

---

## 5. Track M3 — Secrets + provider main path

### Goal

Private v1 can configure models without writing raw API keys into git-backed files by accident.

### M3.1 D-HOST-02 — Provider mapping hardening

| Layer | Work |
|-------|------|
| contracts | Optional `ProviderValidationIssue`; tighten `PiwinConfig` provider fields already present. |
| agent-host | Validate providers on load: protocol, baseUrl URL, non-empty models, apiKeyEnv name shape. |
| agent-host | Map to Pi/model runtime with clear errors (missing key env, bad baseUrl). |
| desktop Settings | Show validation errors; do not save invalid providers. |
| tests | Golden invalid configs. |

### M3.2 D-M2-04 — Keychain / secret refs (MVP)

Product choice (locked for this plan):

- **MVP:** support `apiKeyEnv` only + **optional** OS keychain ref string `apiKeyRef` resolved in host.
- Do **not** store raw keys in `config.json` from Desktop UI (reject or redact on save).

| Layer | Work |
|-------|------|
| contracts | Keep `apiKeyEnv` / `apiKeyRef`; document precedence: ref → env → error. |
| agent-host | `resolveProviderSecret(provider)` using env first; keychain via `keytar` **or** macOS `security` CLI wrapper behind interface (prefer pure optional dep). |
| desktop | Settings: choose env var name; optional “use keychain” flow that writes ref only. |
| doctor | Report whether key resolved without printing secret. |
| tests | Fake secret resolver; never log values. |

**Exit M3:** new settings cannot persist raw `sk-...` into config; doctor shows “key ok / missing”.

**Residual:** Windows Credential Manager polish, migration of existing plaintext configs → D-M2-04b.

---

## 6. Track M4 — Quality main path

### M4.1 Doctor completeness

Extend `piwin doctor` to print a **main-path matrix**:

- host mode, mock, providers (key resolved?), web, skills count, mcp health summary, themes/pets, session index path exists, CI scripts present.

### M4.2 D-M2-05 — Desktop E2E smoke (minimal)

| Work | Detail |
|------|--------|
| Tooling | Prefer Playwright against Vite desktop **or** Tauri driver if already available; if Tauri e2e is heavy, ship **scripted host JSONL smoke** first. |
| Minimum scenarios | (1) host ping (2) project open mock (3) session create/prompt mock (4) session resume loads transcript |
| CI | optional job `e2e-smoke` that can `continue-on-error: false` only when stable |

**Exit M4.2:** one automated path beyond unit tests that fails if resume IPC breaks.

### M4.3 D-ENG-02 (light) — Dependency policy

| Work | Detail |
|------|--------|
| docs | `docs/dependency-policy.md`: allowed license types, no new deps without justification, pin Pi version. |
| CI | optional `pnpm audit --prod` (report-only first). |

---

## 7. Track M5 — Release path (main path, not store)

### Goal

Another machine can build a desktop binary from a clean checkout.

| Work | Detail |
|------|--------|
| scripts | Root or `apps/desktop` script: `package:desktop` → `tauri build` documented prerequisites (Rust, platform deps). |
| docs | `docs/release-desktop.md`: env, signing **optional**, artifact location. |
| D-ENG-03 | Full signing/notarization remains residual if certs unavailable — record **D-ENG-03b unsigned OK**. |

**Exit M5:** documented one-command package; CI may only typecheck/test if build agents lack Rust — then document manual gate.

---

## 8. Task checklist (copy into session todos)

### M1 MCP

- [ ] T1.1 Host-owned manager singleton per HostRuntime / createAgentHost
- [ ] T1.2 Pass manager into `createMcpSessionBridge` on SDK path
- [ ] T1.3 Tests: no double spawn; dispose kills children
- [ ] T1.4 `McpTransportClient` interface + official SDK adapter + fallback
- [ ] T1.5 ADR 0008 update / 0009 if needed
- [ ] T1.6 Project MCP allowlist + permission “Allow for project” for `mcp:connect`
- [ ] T1.7 Desktop still works with Start/Stop + session tools

### M2 Session/host

- [ ] T2.1 Session outline pure helper + tests
- [ ] T2.2 Desktop session list metadata (preview/count/time)
- [ ] T2.3 Optional outline jump list in chat
- [ ] T2.4 Pi JSONL resume spike write-up + decision
- [ ] T2.5 RPC capability honesty + CLI clear failure

### M3 Secrets/providers

- [ ] T3.1 Provider validation on load/save
- [ ] T3.2 Settings UX for validation errors
- [ ] T3.3 Secret resolver interface (env + optional keychain)
- [ ] T3.4 Block raw key save from Desktop
- [ ] T3.5 Doctor key resolved flags

### M4 Quality

- [ ] T4.1 Doctor main-path matrix
- [ ] T4.2 Host JSONL or Desktop e2e smoke
- [ ] T4.3 Wire smoke into CI or document manual
- [ ] T4.4 Dependency policy doc + optional audit

### M5 Release

- [ ] T5.1 package script + release doc
- [ ] T5.2 Residual signing IDs if skipped
- [ ] T5.3 Full `pnpm typecheck && pnpm test` green

### Closeout

- [ ] T6.1 Move completed IDs in `todo-deferred.md` with dates
- [ ] T6.2 Update roadmap §10 status table
- [ ] T6.3 List any new residual IDs created during execution

---

## 9. Per-slice “done” definition

For every track:

1. Types compile (`pnpm --filter <pkg> typecheck` + root if cross-cutting).
2. Tests for touched packages pass.
3. Public exports intentional.
4. `todo-deferred.md` updated (done **and** new residuals).
5. No new dependency without one-line justification in PR/notes.

---

## 10. Risk register

| Risk | Mitigation |
|------|------------|
| Official MCP SDK API mismatch / heavy deps | Interface + fallback; time-box T1.4 |
| Pi JSONL resume not usable | Spike decision; keep product shell |
| Keychain portability | Interface; env-only MVP on Linux CI |
| Tauri e2e flaky | Host JSONL smoke first |
| Scope creep into Artifact/Git polish | Reject; point to §0.3 |

---

## 11. Effort (planning only)

| Track | Relative | Risk |
|-------|----------|------|
| M1 | L | medium–high (SDK) |
| M2 | M | medium (Pi spike) |
| M3 | M | medium (OS secrets) |
| M4 | M | low–medium |
| M5 | S–M | env dependent |

---

## 12. Ready to execute

This plan is **implementation-ready**. Start with **T1.1–T1.3** (MCP single process owner) — highest leverage, lowest product ambiguity.

After each track, update:

- `docs/todo-deferred.md`
- `docs/specs/v1-completion-roadmap.md` §10

Do not mark P6 complete until M1–M4 exits pass; M5 may be “documented manual” if CI lacks Rust.
