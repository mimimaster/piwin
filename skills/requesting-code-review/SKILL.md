---
name: requesting-code-review
description: Produce a short, high-signal review request for a change set.
---

# Requesting Code Review

## Goal
A review request a human (or reviewer agent) can act on without re-deriving intent from the diff alone.

## Done means
- Intent in 1–3 bullets; explicit risk areas.
- Packages/files touched and why.
- Tests run + remaining manual checks.
- Intentional non-goals / residuals called out.
- Specific asks (security, contracts, UX honesty, etc.).
- Link to plan/spec when one exists.

## Stop when
- Change set or intent is unclear — clarify before asking for review.

## Constraints
- Keep it short; no dump of full diffs in the request body.

## Verify
- A reviewer can locate the change, understand risk, and know what feedback is wanted.
