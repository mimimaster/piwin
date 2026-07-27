# PSR Developer-preview smoke (manual Tauri)

| Field | Value |
|-------|-------|
| Date | 2026-07-22 |
| Plan | [`docs/plans/2026-07-22-desktop-product-shell-repair.md`](../plans/2026-07-22-desktop-product-shell-repair.md) |
| Scope | Developer preview only — workspace `pnpm`/`tsx` host bridge; not an installed-app release |

## Preconditions

```bash
pnpm install
pnpm typecheck
pnpm --dir apps/desktop test
pnpm --dir apps/desktop dev:tauri
```

## Checklist

1. Open trusted workspace — **no** Session is auto-created.
2. Create Session via **New session** — composer enables.
3. Compact width ≤1023: Sessions drawer close, Inspector close, scrim, Escape Settings.
4. Desktop width ≥1024: persistent Sessions navigator; Inspector optional.
5. Send prompt with Model A, complete, switch Model B (Composer profile), send again — history remains.
6. While streaming: **Steer now** and **Queue follow-up** text-only; attachments disabled.
7. Permission dialog shows risk-specific card (command / network / mcp).
8. Terminal (Activity tab): opens only for trusted project; `pwd` is inside project.
9. Project switch / untrust closes or refuses Terminal outside trusted root.
10. Status says **Desktop host ready** (transport), not provider readiness.

## Explicit non-claims

- Not an installed Desktop with bundled Node runtime (D1).
- Desktop is SDK-only; no RPC mode switcher (D2).
- Browser Playwright e2e is mock coverage, not native Tauri proof.
