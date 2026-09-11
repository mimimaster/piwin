# Phase 1 implementation summary — Pi working environment

| Field | Value |
|-------|-------|
| Branch | `feat/pi-working-environment-phase1` |
| Date | 2026-09-11 |
| Spec | [2026-09-11-pi-working-environment.md](./2026-09-11-pi-working-environment.md) |

## What shipped

Closed loop only:

1. **Live model catalog** on the Host subscription ModelRuntime.
2. **Recommended ingest** of local Pi config, including missing subscription OAuth keys. No silent boot copy.
3. **Extension compatibility** labels; TUI-only / mixed TUI not loaded into Blueprint.
4. **Non-default `PIWIN_ROOT`** (test-host) does not overlay production `~/.pi/agent` inventory.

Follow vs ingest stay different. Extensions/skills/prompts were already unioned via `loadDiscoveredResources` + `loadPiNativeInventory`. The ingest button writes Host-owned state: merge missing `auth.json` keys. Preview may list already-followed counts.

## Key decisions

- Host `authPath` remains `{PIWIN_ROOT}/pi-agent/auth.json`. Never pointed at `~/.pi/agent/auth.json`.
- Create subscription runtime with `refreshOnCreate: true`, `allowModelNetwork: false` so Host `models-store.json` is restored without blocking boot on network.
- After logged-in providers exist, one `refresh({ allowNetwork: true })` with an ~8s AbortSignal. Failure keeps builtin/cache catalog.
- Session backends still `refresh({ allowNetwork: false })`.
- Ingest merges **missing oauth keys** only. Existing Host keys are not overwritten. Receipt is `{PIWIN_ROOT}/pi-agent/ingest-receipt.json`.
- Host start still creates `{PIWIN_ROOT}/pi-agent` (0700) so empty-store login works.
- Compatibility is a static scan (no module execute). Tiers: `compatible` / `degraded` / `incompatible` / `unverified`. Only `compatible` is Blueprint-loaded by default. `disabledIds` is not silently written.
- Follow of user-global `~/.pi/agent` is gated by an explicit `followPiNativeInventory` flag, defaulting to `isDefaultPiwinRoot(piwinRoot)`. Session `agentDir` (`{PIWIN_ROOT}/pi-agent`) is not used as the CLI inventory path.
- Desktop Settings → OAuth shows 「接入本机 Pi 配置」 when detect is available. Confirm lists missing provider ids, then apply, then `auth/status`.
- CLI `piwin pi-environment apply` was skipped (no large CLI framework change). Desktop + Host IPC is enough.

## Refused (phase 2 / 3)

- `models.json` → product channels (`!command` keys not executed).
- Settings preference import (`defaultModel`, thinking, compaction).
- Symlink / live-share of Pi CLI `auth.json`.
- Cross-machine working-environment export.
- `SYSTEM.md` policy change.
- Copying Pi packages into `~/.piwin/extensions/revisions`.
- `fs.watch` of `~/.pi` or write-back to `~/.pi`.
- Force-enable path for degraded/incompatible extensions.

## Files changed

Contracts: `extension-compatibility.ts`, `pi-environment.ts`, `extensions.ts`, HostCommand union, remote allowlist + idempotency for `pi-environment/apply`.

Agent-host: subscription ModelRuntime create options; `refreshLiveCatalog` on the auth port.

Host-runtime: live catalog refresh after `ensureLoggedInProviders`; `ensureHostPiAgentDir` on start; merge-missing ingest helper; `pi-environment/{detect,preview,apply}` commands; static classifier; Blueprint gating; inventory skip on custom root.

Desktop: OAuth ingest card; Extensions panel tier labels; existing compat notice kept.

Docs: spec, ADR 0002, ADR 0060, architecture §5, subscription OAuth spec, Pi extensions guide.

## Tests

```text
pnpm --filter @piwin/contracts --filter @piwin/agent-host --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/agent-host test -- src/subscription-auth.test.ts
pnpm --filter @piwin/host-runtime test -- src/import-legacy-pi-auth.test.ts src/detect-extension-hooks.test.ts src/discovered-resources.test.ts src/pi-environment.test.ts src/extension-scanner.test.ts src/subscription-auth-service.test.ts src/commands/pi-environment-commands.test.ts src/commands/auth-commands.test.ts src/pi-package-inventory.test.ts src/host-runtime.test.ts
pnpm --filter @piwin/desktop test -- src/settings/pages/oauth-page.test.tsx src/ExtensionsPanel.test.tsx
pnpm --filter @piwin/host-server typecheck
```

Results (this worktree, 2026-09-11):

- typecheck contracts / agent-host / host-runtime / host-server: pass
- contracts tests: 70 files, 507 passed
- agent-host `subscription-auth.test.ts`: 11 passed (includes live catalog overlay mock)
- host-runtime targeted + `host-runtime.test.ts`: pass (including merge-missing auth, custom-root skip, inventory skip, compatibility fixtures, live catalog refresh)
- desktop oauth-page + ExtensionsPanel: 9 passed (ingest button + confirm apply; compat labels)

No edited source file exceeds 1000 lines. New Host commands live in `pi-environment-commands.ts` (catalog-commands.ts remains 913).

## Remaining risks

- Static TUI scan can miss dynamic property access and can false-positive on comments/identifiers. Load failure still has to keep the previous Agent generation.
- Overlay models after a successful pi.dev refresh can be selected only if the bundled Pi protocol already supports them.
- Remote Host ingest reads **the Host machine's** `~/.pi/agent`, not the laptop's.
- Preview followed counts are visibility only; turning off a pi-native extension still uses existing `disabledIds` / Extensions panel, not the ingest button.
- `PI_CODING_AGENT_DIR` is now honored by `getPiAgentDir`. Tests inject that path; they must not depend on the developer home.
