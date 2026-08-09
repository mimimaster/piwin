# Audit categories (improve)

Use as a checklist of **outcomes to search for**, not a forced serial ritual. Every finding needs `file:line`, impact, effort, fix risk, confidence.

1. **Correctness / bugs** — logic errors, race conditions, wrong edge handling, broken invariants
2. **Security** — injection, authz, path traversal, secret leakage, unsafe deserialization, SSRF (vet by-design proxy conventions)
3. **Performance** — N+1, hot-path allocations, unbounded work, missing indexes/cache where evidenced
4. **Test coverage** — missing characterization around risky modules; flaky or absent gates
5. **Tech debt & architecture** — duplicated logic, layering violations, god modules, boundary leaks
6. **Dependencies & migrations** — outdated/vulnerable deps, half-finished migrations, dead feature flags
7. **DX & tooling** — broken scripts, slow feedback, missing typecheck/lint in CI
8. **Docs** — false README/CI instructions, missing operator runbooks for real footguns
9. **Direction** — evidence-grounded next features (cite code/docs); not generic idea-slop

## Vet failure classes
- By-design / ADR-recorded tradeoff reported as bug
- Real issue, wrong file/line
- Duplicate across agents

## Effort levels (advisory)
- **quick**: hotspots; correctness + security + tests; top HIGH only
- **standard**: all categories; hotspot-weighted
- **deep**: whole repo; include LOW “investigate” items; state what was still out of scope
