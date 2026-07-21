# Residual Execution Plan — After P6 Main Path

| Field | Value |
|-------|-------|
| Status | R1 executed 2026-07-20 (R1.1–R1.5 done; R1.6/R1.7 skipped optional) |
| Date | 2026-07-20 |
| Prerequisite | P6 main path M1–M5 **executed** ([`2026-07-20-p6-main-path-completion.md`](./2026-07-20-p6-main-path-completion.md)) |
| Canonical backlog | [`docs/todo-deferred.md`](../todo-deferred.md) |
| Roadmap | [`docs/specs/v1-completion-roadmap.md`](../specs/v1-completion-roadmap.md) §10 |
| Binding rules | `AGENTS.md`; contracts-first; residual work must not regress main path |

---

## 0. Brainstorm conclusions

### 0.1 Why residuals exist

Main path optimized for **private v1 usable end-to-end**. Residuals fall into four buckets:

| Bucket | Nature | Strategy |
|--------|--------|----------|
| **A. Cheap leverage** | Small diffs, high UX/security value | Execute first in short sessions |
| **B. Platform depth** | OS-specific or ops-dependent | Time-box; ship partial if blocked |
| **C. Architecture bets** | Need ADR / Pi capability | Spike → decision → implement or re-defer |
| **D. Content / never** | Skills art, or explicit bans | Content track or leave forever |

### 0.2 Decision principles (for this plan)

1. **Do not reopen main-path architecture** unless a residual is blocked (e.g. Pi JSONL needs ADR 0009 supersede).
2. **Prefer policy extensions over new packages** (e.g. MCP tool remember extends `ProjectMcpPolicy`).
3. **One residual ID → one vertical slice** with tests + todo date when done.
4. **If blocked externally** (no signing cert, no Windows machine), write residual ID + evidence, do not fake done.
5. **Never silent** items (X-*, D-GIT-04) only ship with explicit confirm UX — default is **do not implement**.

### 0.3 Recommended overall order

```text
R1  High leverage polish (MCP tool-remember, MCP watchdog light, host-log, theme remount, art height)
  → R2  Platform & ops (Windows keychain, Tauri e2e optional, signing when certs)
  → R3  Architecture spikes (Pi JSONL tree, RPC custom tools, MCP SSE)
  → R4  Product later / content (sub-agent, plan, git DAG, pet art, skills content)
```

Parallelization: R1 items are mostly independent and can run as parallel small PRs. R3 is sequential with ADRs.

---

## 1. Residual inventory (open only)

### Wave R1 — High leverage (execute)

| ID | Item | Effort | Risk | Deps |
|----|------|--------|------|------|
| D-MCP-02d-tool | Remember `mcp:tool-call` per project | S | low | ProjectMcpPolicy |
| D-MCP-02c | MCP crash auto-restart + heartbeat | M | medium | lifecycle manager |
| D-M2-07 | host-log UI panel | S | low | existing `host/log` push |
| D-THEME-01 | Remount artifacts on theme switch | S | low | desktop theme + MarkdownView |
| D-ART-06 | Expand height >900 with toggle | S | low | ArtifactFrame height policy |
| D-MED-04 | Thumbnail cache / dimensions | S–M | low | media package |
| D-M2-06 | Hot-switch agentMock + restart host | M | medium | Tauri sidecar lifecycle |

### Wave R2 — Platform / delivery (when environment allows)

| ID | Item | Effort | Risk | Blockers |
|----|------|--------|------|----------|
| D-M2-04b | Windows Credential Manager + plaintext migration | M | medium | Windows test env |
| D-M2-05b | Tauri UI e2e driver | L | high | flaky CI; optional |
| D-ENG-03b | Code signing / notarization | M | external | certs / Apple ID |
| D-ENG-04 | Clean corrupt filenames if any | S | low | audit once |

### Wave R3 — Architecture (spike-first)

| ID | Item | Effort | Risk | Notes |
|----|------|--------|------|-------|
| D-M2-01b | Pi native JSONL resume + tree | L | high | Supersede ADR 0009 only if proven |
| D-M2-02-full | Multi-leaf branch graph UI | L | high | Needs 01b data model |
| D-HOST-01b | Full RPC JSONL + custom tools | L | high | Likely needs piwin RPC worker |
| D-MCP-03 | RPC mode stock custom tools | L | high | Same as HOST-01b / ADR 0008 |
| D-MCP-05 | MCP SSE/HTTP transports | M–L | medium | After stdio solid |

### Wave R4 — Product later / content

| ID | Item | Notes |
|----|------|-------|
| D-HOST-03 | Sub-agent / plan mode | Product design first |
| D-HOST-04 | Compaction UI | Events exist |
| D-GIT-02 | Complex DAG viz | Linear graph OK |
| D-GIT-03 | Auto-inject git status to prompt | Policy + noise control |
| D-SK-02 | Richer skill templates | Content |
| D-PET-01 | Full Codex art packs / gallery UX | Content |
| D-ART-05 | Artifact virtualization | Perf when history huge |
| D-ART-07 / D-ART-08 | Embed reporter / hard theme block | Security optional |

### Never implement silently

| ID | Rule |
|----|------|
| X-01..X-04 | Architecture / security invariants |
| D-GIT-04 | force-push / hard reset / clean -fdx only with loud confirm if ever |

---

## 2. Wave R1 — Executable slices

### R1.1 D-MCP-02d-tool — Remember MCP tool calls

**Problem:** Connect is project-remembered; each `mcp:tool-call` still asks.

**Design choice (locked):**

- Extend `ProjectMcpPolicy`:
  - `allowedServerIds: string[]` (existing)
  - `allowAllToolsForServers: string[]` **or** simpler: once connect remembered, **all tools on that server** are allowlisted for tool-call.
- Prefer **server-level tool allow** (not per-tool explosion):  
  `if serverId in allowedServerIds → skip mcp:tool-call ask`.

Alternative (only if product wants finer grain later): `allowedTools: string[]` of exposed names `mcp__srv__tool`.

**Default for this plan: server-level** — matches “Allow for project” mental model.

| Layer | Work |
|-------|------|
| contracts/project | Document that `allowedServerIds` covers connect **and** tool-call |
| mcp-session-bridge | Before tool permission, check `allowedServerIds` |
| host-runtime | `rememberNetworkPermission` / MCP remember path: keep writing server id on `mcp:connect` **and** on `mcp:tool-call` allow+project (add server id if tool-call remembered) |
| desktop | Ensure “Allow for project” on any `mcp:*` action |
| tests | unit: remembered server skips tool-call gate |

**Exit:** Second tool call on allowlisted server does not prompt; unknown server still asks.

**Residual if finer grain needed:** add `D-MCP-02d-tool-fine` later.

---

### R1.2 D-MCP-02c — Watchdog (light)

**Problem:** Crashed MCP stays `running` until next call fails.

**Design (MVP, not k8s):**

| Mechanism | Behavior |
|-----------|----------|
| Heartbeat | Optional `tools/list` or no-op every N seconds **only while status=running** (default off or 30s) |
| Exit listener | On process `close`/`error` → status=`error`, clear client |
| Auto-restart | Config flag `restartOnCrash?: boolean` default **false** for safety; if true, restart once with backoff |

| Layer | Work |
|-------|------|
| contracts | Optional `McpServerConfig.restartOnCrash?: boolean` |
| mcp-lifecycle-manager | process exit → error; optional single restart; expose lastError |
| desktop | Status shows error; user can Start again |
| tests | mock client close → health error |

**Exit:** UI shows error after kill; optional one auto-restart when flag set.

**Do not:** unlimited restart loops, or restart without user config.

---

### R1.3 D-M2-07 — host-log UI panel

| Layer | Work |
|-------|------|
| desktop | Subscribe to `host/log` push; ring buffer (e.g. 200 lines) |
| desktop | Panel or collapsible footer: level filter, clear, copy |
| no host change | unless need log level config later |

**Exit:** During MCP fail / permission, user sees host/log lines without DevTools.

---

### R1.4 D-THEME-01 — Artifact remount on theme change

| Layer | Work |
|-------|------|
| desktop | On `setActiveTheme`, bump `artifactThemeKey` in App state |
| MarkdownView / ArtifactFrame | `key={\`${themeId}:${descriptor.id}\`}` force remount |
| tests | optional: mapper already covered |

**Exit:** Switch ThemePanel → open artifacts re-evaluate with new tokens without app restart.

---

### R1.5 D-ART-06 — Expand height toggle

| Layer | Work |
|-------|------|
| contracts/constants | Export `MAX_ARTIFACT_EXPANDED_HEIGHT = 2200` (or from artifact package) |
| height-policy | Clamp accepts max param |
| ArtifactFrame | Header toggle “Expand / Collapse”; store per-frame expanded boolean |
| tests | clamp expanded max |

**Exit:** Tall dashboards can expand past 900 with user control.

---

### R1.6 D-MED-04 — Thumbnail / dimensions (optional in R1)

| Layer | Work |
|-------|------|
| media | On save, optional sharp/image-size read width/height into asset meta |
| contracts | already has optional width/height on attachments |
| desktop | chip shows small thumb via existing asset URL |

**Skip if dependency heavy** — mark residual and move on.

---

### R1.7 D-M2-06 — Hot-switch agentMock

| Layer | Work |
|-------|------|
| desktop | Settings or doctor: “Restart host with mock on/off” |
| Tauri | Kill sidecar + respawn with env `PIWIN_MOCK=1` or config `agentMock` |
| host | Load `agentMock` from config at serve start (already partially true) |

**Exit:** Toggle without rebuilding app; active sessions cleared with clear UI warning.

---

### R1 acceptance (wave)

- [x] All R1.1–R1.5 shipped or explicitly skipped with todo note  
- [x] `pnpm typecheck && pnpm test` green  
- [x] `pnpm e2e:smoke` green  
- [x] todo-deferred dates updated  

---

## 3. Wave R2 — Platform & delivery

### R2.1 D-M2-04b — Windows secrets

| Work | Detail |
|------|--------|
| secret-resolver | `readKeychain` impl for Windows (Credential Manager via `cmdkey`/`powershell` or `keytar` optional dep) |
| migration | On config load, if raw key detected → refuse + doctor hint to move to env/ref (already reject save) |
| CI | Linux CI keeps env-only; document Windows manual test |

**Exit:** Documented Windows path; macOS+env still green in CI.

### R2.2 D-M2-05b — Tauri UI e2e (optional)

Only if R1 stable for 1+ week:

- Playwright/WebDriver against `tauri dev` **or** skip and keep host smoke as gate.
- Scenarios: open app shell, open settings, session list visible (mock host).

**If flaky:** `continue-on-error` never; better leave residual.

### R2.3 D-ENG-03b — Signing

| Work | Detail |
|------|--------|
| docs | Fill `docs/release-desktop.md` signing section when certs exist |
| scripts | Env-gated `TAURI_SIGNING_*` / Apple notarize |
| todo | Mark done only with real signed artifact evidence |

### R2.4 D-ENG-04 — Repo hygiene

```bash
# one-shot audit
rg --files | rg '\s|\*\*\*|\.ts '
```

Delete/rename junk; no behavior change.

---

## 4. Wave R3 — Architecture spikes (do not implement blindly)

### R3.1 D-M2-01b + D-M2-02-full — Pi tree

| Step | Output |
|------|--------|
| Spike 1–2 days | What Pi SessionManager restores; file path; SDK vs RPC |
| Decision | Keep ADR 0009 **or** ADR 0010 supersede |
| If implement | Store `piSessionFile`; resume API; tree projection types; UI graph |
| If defer | Close spike with notes in ADR 0009 appendix |

**Hard gate:** No UI graph without reliable tree data.

### R3.2 D-HOST-01b + D-MCP-03 — RPC custom tools

| Step | Output |
|------|--------|
| Spike | Can piwin run a **custom** RPC worker with tool registration? |
| Options | A) piwin-owned Node RPC peer B) Pi extension channel C) document SDK-only forever |
| ADR | Required before coding |

**Default bias:** SDK-only for tools remains acceptable for private v1.

### R3.3 D-MCP-05 — SSE/HTTP MCP

| Work | After stdio watchdog (R1.2) proven |
|------|-------------------------------------|
| contracts | `McpServerConfig.transport?: 'stdio' \| 'sse' \| 'http'` |
| mcp | Transport factory; lifecycle manager per transport |
| security | SSRF-like checks for remote MCP URLs |

---

## 5. Wave R4 — Product later (planning only)

Do **not** schedule full implementation until product asks:

| ID | Prerequisite |
|----|----------------|
| D-HOST-03 Sub-agent / plan | Product spec + multi-session policy |
| D-HOST-04 Compaction UI | Compaction events + user control design |
| D-GIT-02/03 | Noise policy for auto-inject; DAG library choice |
| D-SK-02 / D-PET-01 | Content production, not eng |
| D-ART-05/07/08 | Perf measurement first |

For each, write a one-pager under `docs/specs/` before code.

---

## 6. Task checklist (R1 first — copy to todos)

### R1.1 MCP tool-remember
- [x] T-R1.1a Document server-level tool allow in contracts/project
- [x] T-R1.1b Bridge skips `mcp:tool-call` when server allowlisted
- [x] T-R1.1c Remember on tool-call allow+project writes server id
- [x] T-R1.1d Tests + Desktop “Allow for project” on mcp:*

### R1.2 MCP watchdog
- [x] T-R1.2a Process exit → error status
- [x] T-R1.2b Optional `restartOnCrash` single retry
- [x] T-R1.2c Tests with mock process close

### R1.3 host-log panel
- [x] T-R1.3a Ring buffer + UI
- [x] T-R1.3b Wire existing host/log subscription

### R1.4 Theme remount
- [x] T-R1.4a artifactThemeKey on theme apply
- [x] T-R1.4b Remount ArtifactFrame

### R1.5 Artifact expand
- [x] T-R1.5a Expanded max constant + clamp
- [x] T-R1.5b Toggle in ArtifactFrame + test

### R1.6 / R1.7 (optional in same wave)
- [ ] T-R1.6 Thumbnail dimensions if cheap — **skipped** (dependency weight; remains D-MED-04)
- [ ] T-R1.7 Mock hot-switch via sidecar restart — **skipped** (remains D-M2-06)

### R1 closeout
- [x] T-R1.z typecheck/test/e2e:smoke; update todo-deferred

---

## 7. Session plan (suggested)

| Session | Scope | Outcome |
|---------|--------|---------|
| **RS1** | R1.1 + R1.2 | MCP trust + stability |
| **RS2** | R1.3 + R1.4 + R1.5 | Desktop polish cluster |
| **RS3** | R1.6/R1.7 as needed | Optional |
| **RS4** | R2 items with env | Platform |
| **RS5** | R3 spikes only | ADR decisions, little code |

Do not mix R3 spikes with R1 feature PRs.

---

## 8. Done definition (any residual slice)

1. Touched packages: `typecheck` + `test` green.  
2. If host IPC changed: `pnpm e2e:smoke` green.  
3. `docs/todo-deferred.md`: ID → done with date **or** new residual ID.  
4. No main-path regression (resume, MCP start/stop, secrets).  
5. No new dependency without justification.

---

## 9. Risk register

| Risk | Mitigation |
|------|------------|
| Auto-restart MCP surprises user | Default off; single retry; clear status |
| Tool-remember too broad | Server-level first; fine-grain later |
| Pi JSONL half-implemented | Spike gate; ADR |
| Tauri e2e flaky | Prefer host smoke; residual OK |
| Signing blocked | Document; D-ENG-03b stays open |

---

## 10. What not to do

- Do not implement D-GIT-04 / force-push without product decision + confirm modal.
- Do not claim RPC custom tools without worker/ADR.
- Do not expand Artifact virtualization before measuring jank.
- Do not parallel large R3 refactors with R1 polish in one PR.

---

## 11. Ready to execute

**Start here:** **RS1 = T-R1.1a–d (MCP tool-remember)**, then **T-R1.2 (watchdog light)**.

Highest user-visible pain after main path: repeated MCP tool prompts + opaque process death.

When R1 completes, reassess whether R2/R3 are worth private v1 time; many teams stop after R1 for a private shell.
