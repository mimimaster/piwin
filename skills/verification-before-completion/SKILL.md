---
name: verification-before-completion
description: Require fresh evidence before claiming work is done, fixed, or passing.
---

# Verification Before Completion

## Goal
A completion claim the user can trust because it is backed by checks run in this environment.

## Done means
- Relevant verification ran here (e.g. package typecheck/tests, e2e when warranted).
- Result is summarized from **actual** output (pass/fail), not assumed.
- If public API or user-visible behavior changed, exports/docs were checked.
- Architecture boundaries still hold (no apps→Pi imports; no accidental god-module growth) when those surfaces moved.

## Stop when
- Required checks cannot run or fail — report the blocker; do not claim green.

## Constraints
- Prefer automated failing tests over manual-only checks when practical.

## Verify
- “Done / fixed / passing” appears only after the evidence above exists in this session.
