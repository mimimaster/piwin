# Claude Code / Codex Host staging (step 6)

Status: local staging passed. Not marketplace publication, Desktop release, or real provider smoke.

## Environment

- Plugin sources: `/Volumes/BigDisk/Developer/piwin-claude-code-backend`, `/Volumes/BigDisk/Developer/piwin-codex-backend`
- Host test: `packages/host-runtime/src/extension-claude-codex-staging.integration.test.ts`
- Temp `piwinRoot` only. Artifacts copied as `piwin.json` + `dist/agent.mjs`; adapter source is not vendored into `@piwin/*`.

## Commands

```sh
pnpm --filter @piwin/host-runtime exec vitest run \
  src/extension-claude-codex-staging.integration.test.ts \
  src/grok/agent-plugin-lifecycle.integration.test.ts
pnpm --filter @piwin/host-runtime typecheck
pnpm test:architecture
```

Plugin repos: `tsc --noEmit` and `vitest run`.

## Results

| Check | Result |
| --- | --- |
| Staging install of both backends | pass (5/5 staging tests, 274ms) |
| Existing fixture lifecycle | pass (10/10, 520ms) |
| Independent enable/disable | pass — disabling Claude leaves Codex enabled; `session/create` Claude → `agent-plugin-disabled` |
| Tamper | pass — `agent-artifact-integrity`; Codex remains installed |
| Uninstall Claude | pass — gone from `extensions/list`; Codex remains; `agents/list` still `agents-inventory-retired` |
| Artifact size | both under `AGENT_PLUGIN_MAX_ARTIFACT_BYTES` (19 572 / 16 534 bytes) |
| Host deps vendor adapters | pass — no `claude-agent-sdk` / `@openai/codex` in host-runtime or agent-host dependencies |
| Production source vendor strings | pass — no hits in host-runtime/agent-host production |
| Architecture boundaries | pass |
| host-runtime typecheck | exit 0 |
| Claude plugin tests | 6 files / 8 tests |
| Codex plugin tests | 4 files / 4 tests |

## Not verified

- Real Claude Agent SDK + user-owned executable prompt / PTY roundtrip
- Real Codex `app-server` (platform vendor binary still ENOENT; not repaired)
- Marketplace publish / Desktop installer
- `pnpm test:bundle` (bundle inputs unchanged)
- Native-history resume across Host restart for these two plugins (fixture lifecycle covers the generic path)
