---
name: verification-before-completion
description: Require evidence before claiming work is done, fixed, or passing.
---

# Verification Before Completion

Before saying done:

1. Run the relevant commands (`pnpm typecheck`, package tests, e2e as needed).
2. Paste or summarize **actual** command output (pass/fail).
3. Check public exports and docs if architecture or user-visible behavior changed.
4. Confirm no forbidden imports (apps ↛ Pi) and no accidental god-module growth.

Never claim green without running verification in this environment.
