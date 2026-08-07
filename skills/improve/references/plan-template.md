# Handoff plan template (improve)

Executor has **zero** advisor-session context. Assume competent at following explicit steps; weak at filling gaps.

Three properties:

1. Self-contained context (paths, excerpts, conventions, commands)
2. Verification gates (command + expected result per step)
3. Hard boundaries + STOP (no improvisation)

File: `plans/NNN-short-slug.md`

---

```markdown
# Plan NNN: <What will be true after>

> **Executor**: Follow step by step. Run every verify before next step.
> On any STOP condition — stop and report; do not improvise.
> Update `plans/README.md` status unless a reviewer owns the index.
>
> **Drift check first**: `git diff --stat <planned-at SHA>..HEAD -- <in-scope paths>`
> If in-scope files changed, compare Current state excerpts to live code; mismatch → STOP.

## Status
- **Priority**: P1 | P2 | P3
- **Effort**: S | M | L
- **Risk**: LOW | MED | HIGH
- **Depends on**: plans/NNN-*.md | none
- **Category**: bug | security | perf | tests | tech-debt | migration | dx | docs | direction
- **Planned at**: commit `<short SHA>`, <YYYY-MM-DD>

## Why this matters
2–5 sentences: problem, cost, what improves.

## Current state
- Files + one-line roles (`path` — role; lines N–M)
- Short current excerpts with `file:line`
- Conventions + exemplar path (“match `src/…`”)
- Relevant ADR/PRODUCT vocabulary quoted if load-bearing

## Commands you will need
| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `…` | exit 0 |
| Tests | `…` | all pass |
| Lint | `…` | exit 0 |

(Exact repo commands from recon — not guessed.)

## Scope
**In scope** (only these may change):
- `path`

**Out of scope** (do not touch):
- `path` — reason

## Steps
### Step 1: <imperative>
What / which symbols. Target shape when load-bearing.
**Verify**: `<command>` → <expected>

### Step 2: …

## Test plan
- New tests, file, cases (happy, regression, edges)
- Structural pattern exemplar: `…test.ts`
- **Verify**: `<test command>` → pass including N new tests

## Done criteria
ALL must hold:
- [ ] typecheck exit 0
- [ ] tests exit 0; new tests exist
- [ ] no files outside in-scope (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions
- Current state excerpts mismatch live code
- Verify fails twice after a reasonable fix
- Fix seems to require out-of-scope files
- Key assumption “…” is false

## Maintenance notes
- Future interactions; what reviewers should scrutinize; deferred follow-ups
```

## Index: `plans/README.md`

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | …     | P1       | S      | —          | TODO   |

Status: TODO | IN PROGRESS | DONE | BLOCKED (reason) | REJECTED (reason)

## Findings considered and rejected
- <id>: <one line>
