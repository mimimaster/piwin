# Coding Agent Usability Scorecard

| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
| Functional correctness | 25 | 20 | Contracts/store/Host/CLI/Desktop focused tests and full unit suite pass; native live queue remains unverified |
| State and recovery | 20 | 14 | Durable restart reconciliation, replay/hydration and exact terminal barriers pass; no real two-client/native restart run |
| Architecture discipline | 15 | 14 | Contracts-first, package boundary gate passes, Host remains authority; dirty-base scope limits confidence slightly |
| Planning and autonomy | 15 | 12 | Long task was split into documented stages and bug-fix loop; no destructive cleanup or false green claim |
| Collaboration transparency | 10 | 9 | Frequent status/evidence updates and explicit residuals; proactive subagent fan-out was not used in this mode |
| Tests and evidence | 10 | 8 | Full typecheck/test/build/Cargo/JSONL evidence; format and browser E2E remain baseline blockers |
| Efficiency | 5 | 4 | Found and fixed 9 concrete bugs with regression coverage; some broad validation was repeated after dirty-baseline failures |

**Total: 81 / 100**

## Rescue ledger

No human rescue recorded. Expected permission choices and planned fault injection do not count as rescue.

## Decision

**Conditional use.** The coding agent handled a multi-package Host-first slice, kept the working tree safe, found non-trivial ordering/bounds/projection bugs, and left reproducible evidence. It is not yet evidence-backed for unrestricted daily complex development because the browser E2E baseline is red/timeout-prone and Native Tauri long-session, real-provider, two-client restart behavior was not exercised.
