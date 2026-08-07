---
description: Review recent changes for bugs, security, and missing tests
---

# Code Review

## Goal
A severity-ordered review of recent changes a maintainer can act on.

## Done means
- Findings for: bugs/logic errors, security (secrets, injection, path traversal), error-handling gaps, missing tests for non-trivial behavior.
- Each finding has severity and a concrete file reference.
- Intentional non-goals or residuals noted briefly when relevant.

## Stop when
- Diff/intent is unclear — say what is missing instead of inventing issues.
- No material issues — state that explicitly; do not pad.

## Verify
- Claims cite paths or symbols present in the change set.
