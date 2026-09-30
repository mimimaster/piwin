# Optional Agent implementation and acceptance evidence

Scope: original Agent plugin lifecycle + marketplace distribution + Grok ACP finishing work. Local implementation is not public deployment. Branch: `feat/grok-acp-backend`; separate site checkout: `.worktrees/piwin-extensions-agent`, branch `feat/agent-catalog`.

## Added implementation

- Contracts and `@piwin/agent-plugins`: declarative reviewed recipes, SHA-bound revisions, installation records, persistent enable/disable/uninstall, user-owned binary selection, fail-closed corrupt inventory. Host injects existing serialized atomic persistence; no third-party install hooks or JS.
- Host/CLI: actual Agent commands, no CLI probe during inventory/market reads, prompt admission checks even for resident handles and queued drain, adapter revision binding, history preservation on uninstall, selected-path detection without fallback, invalidation of late readiness results.
- Marketplace/Desktop: Agent kind/filter, reviewed offline Grok entry, separate agents.json parser/cache, exact digest and id/version validation, inventory projection and mutations; Settings supports installation, toggles, uninstall confirmation, Host runtime path and safe MCP observation.
- Site: Agent list/detail routes, independently versioned agents.json and content-bound declarations; old extension index v1 unchanged. Browser only copies catalog identity, never executes installation.

## Verification actually run

- Full `pnpm check` passed (Job `8a268ecd-c013-4523-9ba8-cbb3ab967097`, exit 0, final `Package boundaries OK`). Final `pnpm typecheck` also passed after the mock-platform fixture seam.
- Agent inventory store: 12 tests passed. Grok readiness + plugin lifecycle: 7 tests passed in the verification lane. ACP package after wire-fixture correction: 46 tests passed. Marketplace after fetch injection repair: 79 tests passed.
- Site: `npm test` 50/50 passed; `npm run build` passed. Generated site agents.json was consumed by the real piwin marketplace parser and returned `agent:grok`, version `1.0.0`.
- Real Grok 1.0.44 MCP smoke: 0 model prompts/fees. Wire keys: detail/name/reason/sessionId/source/status/tools. Observed status was `unavailable`; the projector produced only server name, status and a generic connection-error hint. Raw reason/config/auth/headers/env were not printed. Temporary native session was deleted and process/temp directory closed.
- Actual browser DOM + delivered screenshot proof against a disposable real Host with fake ACP: Settings install → explicit Check → disable → enable → uninstall confirmation → installation entry returns. Marketplace Agent filter → Grok details → Install; an attached CLI then read the installed adapter.
- CLI attached to that same Host: install/list/disable/enable/uninstall/list succeeded; final inventory empty. No real model prompt was sent by this browser/CLI fixture.
- `git diff --check` and architecture boundaries passed. New/touched plugin production files remain below 1000 lines; legacy feature-branch locale size is a separate pre-existing refactor debt, not claimed fixed here.

## Failures found, not hidden

1. Queue drain default vi.waitFor deadline was 1s despite the outer test allowing 15s. It sampled the intermediate `starting` state under load. The existing polling now waits for persisted `started` with a bounded 10s deadline.
2. Cold-activation rollback setup sampled resident-idle before final Run cleanup. The test now waits for an actual successful suspension, leaving production lifecycle unchanged.
3. Marketplace search injected fetch into npm/GitHub but not the MCP registry. Tests unintentionally used live network and timed out. The registry now accepts the same fetch/signal; a regression rejects any escape to global fetch.
4. MCP projection initially missed Grok's real `unavailable` enum. A sanitized fixture and non-paid smoke verified the corrected mapping.
5. Existing HostServer webRoot startup failed because its WebSocket wrapper did not expose an HTTP server. This is outside this feature and was not silently called fixed. Browser smoke used a separate static HTTP port and the same real WebSocket Host.

## Remaining release gates / explicit product boundaries

- Neither repository has been merged, pushed or publicly deployed by this task. Site publication requires approval to push/PR and the protected-main/Pages workflow.
- Adapter install is real; official Grok binary installation remains manual until a distribution/verification recipe is validated. Do not call it an automatic CLI installer.
- Only macOS Host is claimed reviewed. Windows/Linux integration fixtures may simulate macOS with a mock-only port; production cannot override platform verification.
- Existing paid ACP protocol evidence from 2026-09-29 remains the live model-turn evidence. No redundant paid prompt was sent in this completion slice.
