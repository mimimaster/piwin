# Plan — Composer `/` menu (modes · commands · skills)

| Field | Value |
|-------|-------|
| Status | **Executed 2026-07-22** — S1–S4 shipped (Desktop slash menu + /compact intercept) |
| Date | 2026-07-22 |
| Skill | `writing-plans` |
| Surface | Desktop composer only (CLI parity deferred) |
| Spec seed | this plan (replaces corrupted draft specs) |
| Research | Cursor 3.12.17 + official CLI/skills docs (see §0) |

---

## 0. Goal / non-goals

### Goal

In the Desktop composer, typing `/` opens a ranked menu of:

1. **Commands** — product actions (local, not model turns when applicable)
2. **Modes** — Agent / Plan / Debug / Ask
3. **Skills** — installed + bundled skills (including **`create-skill`**)

Sending `/compact` (and aliases) runs **Pi compaction** via existing `session/compact`.

### Non-goals

- Cursor-only product surface: `/canvas`, `/automate`, `/babysit`, `/cursor-blame`, `/sdk`, Cursor `/shell` skill, `/statusline`, `/update-cli-config`, `/update-cursor-settings`, `/split-to-prs`, `/review-bugbot`, `/review-security`, `/loop`, `/onboard`, `/migrate-to-skills`, `/create-hook`, `/create-subagent`, `/worktree`, `/best-of-n`, `/side`, `/btw`, Design Mode, Multitask/Triage/Custom modes
- Full Cursor CLI utility set (`/vim`, `/plugin`, `/sandbox`, `/bedrock`, `/mcp list`, …)
- Replacing Cmd+K command palette or `+` menu
- Reimplementing summarizer (still Pi `compact`)
- Custom `.cursor/commands/*.md` store (later)
- `@` context mentions (separate feature)

---

## 1. Constraints

| Rule | Implication |
|------|-------------|
| `AGENTS.md` host boundary | UI never imports Pi; only `session/compact` etc. via host client |
| Contracts first | No new IPC required for v1 (reuse compact/abort/skills/list) |
| Product transcript | Bare `/compact` does **not** create a user→model turn |
| Desktop locale | Labels follow desktop locale (zh-CN default) |
| Strict TS / ESM | Pure helpers + colocated tests |

---

## 2. Catalog lock (capability-filtered)

Filter rule: **only items piwin already has runtime for, or this plan implements with existing IPC.**

### 2.1 Modes (all ship — already in `agent-mode.ts`)

| Slash | Kind | Action on select | Action on send (message is only this token) |
|-------|------|------------------|-----------------------------------------------|
| `/agent` | mode | set mode=agent; remove token | set mode; clear; **no** prompt |
| `/plan` | mode | set mode=plan; remove token | set mode; clear; no prompt |
| `/debug` | mode | set mode=debug; remove token | set mode; clear; no prompt |
| `/ask` | mode | set mode=ask; remove token | set mode; clear; no prompt |

Not in catalog: TRIAGE / PROJECT / MULTITASK / CUSTOM / Design Mode / Manual.

### 2.2 Commands (static product)

| Slash | Aliases | Backend | Notes |
|-------|---------|---------|-------|
| **`/compact`** | `/summarize`, `/compress` | `session/compact` | Optional args → `customInstructions` (cap 2KB) |
| **`/stop`** | `/abort` | `session/abort` | Only meaningful while streaming; otherwise soft message |

**Explicitly out (v1):** `/new`, `/clear`, `/model`, `/help`, `/mcp`, `/export`, Cursor CLI utilities.

Rationale: `/new` is destructive-ish (session lifecycle) and already has UI; `/model` is titlebar/settings. Keep command set tiny and correct.

### 2.3 Skills (dynamic from `skills/list` + always expect bundled)

**Always present when installed (bundled today under repo `skills/`):**

| Slash | Skill | Why keep |
|-------|-------|----------|
| `/create-skill` | create-skill | PRD SK-07; Cursor also ships this; **must** |
| `/find-skill` | find-skill | PRD SK-06 |
| `/writing-plans` | writing-plans | core workflow |
| `/executing-plans` | executing-plans | core workflow |
| `/systematic-debugging` | systematic-debugging | core workflow |
| `/verification-before-completion` | verification-before-completion | core workflow |
| `/requesting-code-review` | requesting-code-review | core workflow |
| `/using-git-worktrees` | using-git-worktrees | core workflow |
| `/web-research` | web-research | tools-web companion |
| `/hatch-theme` | hatch-theme | product |
| `/hatch-pet` | hatch-pet | product |

Plus **any other skill** returned by `skills/list` (user/project/extraPaths).

**Cursor built-ins intentionally NOT mapped (unsupported product):**

`canvas`, `automate`, `babysit`, `create-hook`, `create-subagent`, `cursor-blame`, `loop`, `migrate-to-skills`, `onboard`, `review`, `review-bugbot`, `review-security`, `sdk`, `shell`, `split-to-prs`, `statusline`, `update-cli-config`, `update-cursor-settings`.

**Not in piwin skills tree today → do not fake in slash catalog:**

`create-rule` (PRD mentions; no `skills/create-rule` yet — **out until skill exists**).

### 2.4 Skill invoke shape (Cursor-aligned)

- Menu shows `/create-skill`, not `/skill create-skill`.
- Select skill → replace active `/token` with `/create-skill ` (trailing space for args).
- On send: if entire message matches `^/<skillName>(?:\s+(.*))?$` and name is a known skill → rewrite for host (internal prefix) like mode preambles; transcript keeps user-visible `/name …` text (same honesty pattern as mode).

Disabled skills: show grayed; select → toast/reason, do not enable automatically.

### 2.5 Compression naming

| Primary | Aliases | One action |
|---------|---------|------------|
| `/compact` | `/summarize`, `/compress` | `session/compact` |

Keep toolbar compress button.

---

## 3. UX behavior

### Open / close

- Open when active token (from last whitespace or SOL to caret) starts with `/`, composer interactive (session + trusted + not aborting).
- Mid-line tokens allowed.
- Close: Esc, outside click, apply, token no longer slash.

### Rank

1. Prefix match on `name`
2. Substring on name/label/keywords/description
3. Tie-break group order: **Command → Mode → Skill**
4. Cap 12 rows

### Select vs send

| Kind | Select | Send whole-message slash |
|------|--------|---------------------------|
| Command compact | Insert `/compact ` (args OK) | Execute compact; clear composer; no user bubble |
| Command stop | Insert `/stop` | Abort stream; clear |
| Mode | Set mode; strip token | Mode-only message → set mode + clear |
| Skill | Insert `/name ` | Skill rewrite + `session/prompt` |

Unknown `/foo` → send as normal user text (no hard block).

### Keyboard

↑↓ highlight · Enter/Tab apply when menu open · Esc close · Enter send when menu closed.

---

## 4. Architecture

```text
apps/desktop/src/slash/
  slash-catalog.ts     # static commands + modes + skills → SlashItem[]
  slash-match.ts       # filter/rank pure
  slash-parse.ts       # active token + submit parse
  slash-menu.tsx       # popover UI
  *.test.ts

composer-dock.tsx      # caret, open state, keys
hooks/use-composer-slash.ts   # optional state glue
hooks/use-session-actions.ts  # send intercept
styles/*               # menu CSS
e2e                    # mock host: open / + /compact
```

No new `@piwin/*` package. No Pi imports.

Data flow:

```text
composer + caret
  → detectActiveSlashToken
  → buildSlashCatalog({ modes, skills, capabilities, streaming, compacting })
  → filterSlashItems(query)
  → SlashMenu
Send:
  parseComposerSlashCommand(trimmed)
    compact* → handleCompact(args)
    stop*    → handleAbort()
    mode-only → setAgentMode + clear
    known skill → applySkillToPrompt + session/prompt
    else → applyAgentModeToPrompt + session/prompt
```

Extend `handleCompact` to accept optional `customInstructions`.

---

## 5. Vertical slices

### S0 — Catalog + docs freeze (½ h)

| | |
|--|--|
| **Owner** | docs |
| **Files** | `docs/plans/2026-07-22-composer-slash-menu.md` (this file); optional short pointer in `docs/todo-deferred.md` |
| **Work** | Lock §2 catalog; no code |
| **Exit** | Human OK on §2 (or answers to §8) |

### S1 — Pure parse / match (½–1 d)

| | |
|--|--|
| **Owner** | `apps/desktop` |
| **Files** | `slash/slash-parse.ts`, `slash-match.ts`, `slash-catalog.ts` + tests |
| **Work** | Token detect; catalog builders; rank; submit parse for compact/summarize/compress/stop/modes/skills |
| **Tests** | vitest: `/comp` ranks compact; aliases map; mode-only; skill name; unknown passthrough; mid-line token |
| **Exit** | unit green |

### S2 — Slash menu UI + composer wire (1 d)

| | |
|--|--|
| **Owner** | `apps/desktop` |
| **Files** | `slash-menu.tsx`, `composer-dock.tsx`, CSS, optional `use-composer-slash.ts` |
| **Work** | Popover above composer; sections Command/Mode/Skill; keyboard; availability gray states |
| **Tests** | unit for catalog availability; manual smoke |
| **Exit** | type `/` shows menu with compact + 4 modes + create-skill when listed |

### S3 — Send intercept (½–1 d)

| | |
|--|--|
| **Owner** | `apps/desktop` |
| **Files** | `hooks/use-session-actions.ts` (send + compact args) |
| **Work** | `/compact` → compact IPC; `/stop` → abort; mode-only; skill rewrite; streaming guards |
| **Tests** | unit where pure; e2e mock: type `/compact` + Enter → compact banner / mock compact call |
| **Exit** | AC below green |

### S4 — Polish + e2e (½ d)

| | |
|--|--|
| **Owner** | `apps/desktop` |
| **Files** | locale strings, e2e, residual CSS |
| **Work** | zh-CN labels; unavailable reasons; keep + menu & compress icon |
| **Exit** | `pnpm --dir apps/desktop` typecheck + unit + targeted e2e |

---

## 6. Acceptance criteria

1. Trusted active session: type `/` → menu with **Commands / Modes / Skills**.
2. Menu includes `/compact`, aliases listed or match via filter; **no** `/canvas`.
3. Menu includes `/agent` `/plan` `/debug` `/ask`.
4. Menu includes `/create-skill` when skill installed (bundled).
5. Select `/compact` → composer becomes `/compact ` (or exact insert); menu closes.
6. Send `/compact` → compaction runs; **no** model user turn; banner works.
7. Send `/compact keep tools` → `customInstructions: "keep recent tools"` (or full args string).
8. Send `/summarize` or `/compress` → same as compact.
9. Send `/stop` while streaming → abort.
10. Select `/plan` → mode Plan; token removed; no prompt.
11. Select `/create-skill` → draft `/create-skill `; Send → skill-aware prompt path.
12. Escape closes menu; text kept.
13. Toolbar compact still works.
14. Typecheck + unit + e2e for slash+compact path pass.

---

## 7. Risks / do-not-do

| Risk | Mitigation |
|------|------------|
| Skill name collides with command (`/stop` vs skill) | Commands win on exact name in catalog; reserved set |
| Sending skill as plain text without rewrite | Only rewrite when name ∈ skills/list |
| Mid-line `/compact` accidental execute | **Whole-message** command match only on send |
| bloating menu with Cursor names | Hard deny-list in catalog comments + tests |
| RPC no compaction | Item `available: false` + reason |

**Do not:**

- Add canvas/automate/etc. stubs that open empty panels
- Delete product transcript on compact
- Put shell navigation (Settings) into slash v1

---

## 8. Decisions (defaults applied; change only if you object)

| # | Topic | Default in this plan |
|---|-------|----------------------|
| D1 | Compression names | `/compact` + aliases `/summarize` `/compress` |
| D2 | Skill form | Cursor-style `/create-skill` (no `/skill ` prefix) |
| D3 | `/stop` | **In** (maps to existing abort) |
| D4 | `/new` `/model` | **Out** of v1 |
| D5 | `create-rule` | **Out** until skill exists |
| D6 | Select compact | Insert; execute on Send |
| D7 | Unknown slash | Send as normal text |
| D8 | Scope | Desktop only |

---

## 9. Recommended start order

1. **S1** pure parse/match/catalog (+ tests)  
2. **S2** UI wire  
3. **S3** send intercept (`/compact` first, then stop/mode/skill)  
4. **S4** e2e + polish  

Estimated: **~2–3 focused days** Desktop-only.

---

## 10. File touch list

| Path | Action |
|------|--------|
| `docs/plans/2026-07-22-composer-slash-menu.md` | this plan |
| `apps/desktop/src/slash/*` | new |
| `apps/desktop/src/composer-dock.tsx` | wire menu + keys |
| `apps/desktop/src/hooks/use-session-actions.ts` | intercept + compact args |
| `apps/desktop/src/hooks/use-composer-slash.ts` | optional |
| `apps/desktop/src/styles/*.css` | popover |
| `apps/desktop/e2e/*.spec.ts` | slash + compact |
| contracts / agent-host | **no change** if IPC already enough |

---

## 11. Cursor → piwin filter matrix (audit)

| Cursor item | In v1? | Reason |
|-------------|--------|--------|
| Mode Agent/Ask/Plan/Debug | yes | already |
| Mode Multitask/Triage/Custom | no | unsupported |
| `/summarize` `/compress` | yes as aliases | compact |
| `/compact` | yes (primary) | Pi name |
| `/plan` `/ask` `/debug` | yes (mode) | |
| `/create-skill` | yes | bundled skill |
| `/find-skill` + other bundled | yes | dynamic list |
| `/canvas` etc. | **no** | unsupported |
| `/stop` | yes | abort IPC |
| Custom commands md | no | later |

