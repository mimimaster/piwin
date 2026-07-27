---
name: systematic-debugging
description: Debug failures with a short evidence-first loop before changing code.
---

# Systematic Debugging

1. **Reproduce** — capture exact command, error text, and environment.
2. **Localize** — identify the smallest failing surface (file, test, log line).
3. **Hypothesis** — write one falsifiable cause; do not shotgun-edit.
4. **Probe** — add a minimal check (log, assertion, unit test) that would disprove it.
5. **Fix** — smallest change that passes the probe.
6. **Verify** — re-run the failing path + one nearby regression check.
7. **Record** — note root cause in the session/PR so the next agent does not re-discover it.

Rules: never claim fixed without evidence; prefer failing tests over manual-only checks.
