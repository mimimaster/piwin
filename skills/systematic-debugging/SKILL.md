---
name: systematic-debugging
description: Resolve failures with an evidence-first loop and a verified fix.
version: 2
---

# Systematic Debugging

## Goal
A root-caused, minimal fix for a reproduced failure, with evidence it no longer fails.

## Done means
- Failure is reproduced with exact command, error text, and environment notes.
- Smallest failing surface is identified (file, test, log line).
- One falsifiable hypothesis was tested with a minimal probe (log, assertion, or failing test).
- Smallest fix that passes the probe is in place.
- Original failing path plus one nearby regression check pass.
- Root cause is recorded briefly for the next agent/PR.

## Stop when
- Cannot reproduce — gather more evidence; do not shotgun-edit.
- Hypothesis disproved — form the next single hypothesis; do not stack unrelated changes.

## Constraints
- No “fixed” claim without re-run evidence in this environment.

## Verify
- Failing path is green after the fix; probe/test remains as lasting signal when useful.
