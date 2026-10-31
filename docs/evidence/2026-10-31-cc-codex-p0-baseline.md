# Claude Code / Codex P0–P3 start evidence

Status: local implementation slice, not a three-repository release candidate.
Not marketplace publication, Desktop release, or real-provider acceptance.

## Fingerprints before this change

| Repo | Revision | Dirty |
| --- | --- | --- |
| Core `/Volumes/BigDisk/Developer/piwin` | `114e60ceb4180d87f990ec3b35f0d8ec6f39e337` | yes — unrelated Desktop appearance files; not mixed into this work |
| Claude `/Volumes/BigDisk/Developer/piwin-claude-code-backend` | unborn `master` before this slice; local checkpoint `21c28ff4727acadc57c17caef17ed8c47003cd3d` (not pushed) | clean after checkpoint |
| Codex `/Volumes/BigDisk/Developer/piwin-codex-backend` | unborn `master` before this slice; local checkpoint `385fbaf4dfbe2e4e1ff7fbdcacad38e9563a2bc5` (not pushed) | clean after checkpoint |

Secrets scan (plugin roots): no `.env`, credentials, or key files. `dist/` and `node_modules/` are gitignored. Codex `node_modules` had been installed with `pnpm@11.9.0` and a placeholder `pnpm-workspace.yaml` (`allowBuilds.esbuild: set this to true or false`).

## What landed in this slice

### P0 — reproducible toolchain and required-lane inputs

- Plugin `packageManager`: `pnpm@9.15.0`
- Plugin `engines.node`: `>=22.23.4`
- Removed invalid `pnpm-workspace.yaml` stubs; keep `pnpm.onlyBuiltDependencies: ["esbuild"]`
- Core staging/local-binary tests no longer default to `/Volumes/BigDisk/...`
- Required lane: `PIWIN_REQUIRE_EXTERNAL_BACKENDS=1` plus `PIWIN_CLAUDE_BACKEND` / `PIWIN_CODEX_BACKEND`
- Ordinary core tests skip plugin staging when those env vars are unset
- Vendor-adapter absence check always runs

### P1 / P2 — Claude exact-id resume

- Regression: fresh plugin `session/load` of a stored native id, then first prompt
- Fix: loaded slots with a Host-stored vendor id set `nativeBound` so the first prompt sends `resume`
- `session/new` first prompt still has no synthetic `--resume` (CC-02)

### P3 start — Codex real stdio client

- Official docs (2026-10-31 / rechecked this session): stdio is `--listen stdio://` (default), not `--stdio`
- Replaced production stub in `src/main.ts` with `createAppServerStdio`
- Fake executable answers `turn/start` immediately and emits the rest later
- Plugin Host Run waits for `turn/completed`, not the start response
- PATH `codex` on this machine remains the broken npm wrapper (`ENOENT` vendor binary). Native CX-05 stays blocked.

## Compatibility declarations (honest)

- Artifact `platforms` remain Node ESM (`darwin`/`win32`/`linux`): bundle portability, not reviewed native CLI support
- Claude `verifiedCliVersions`: `2.1.281` on darwin from prior local detection only
- Codex `verifiedCliVersions`: empty
- Linux/Windows native smoke: not-run
- Real Claude/Codex provider prompts: not-run
- Desktop/browser E2E (including Codex computer-use): deferred to P6

## Commands / results

Environment: macOS arm64, Node `v24.11.1`, pnpm `9.15.0`

### BUILD-01 plugin disposable workspaces

`pnpm install --frozen-lockfile` (no plugin-repo `node_modules`), `pnpm typecheck`, `pnpm test`, two `pnpm build`s.

| Plugin | Tests | Digest | Bytes | Two-build identical | Staged launch without `node_modules` |
| --- | --- | --- | --- | --- | --- |
| Claude | 15/15 then 17/17 after resume tests | `04802ac6…` before resume fix; after fix `f0b15cdb85b8b3fe2229d9d72ff99756a86b2d7914ace6d5314edb5b5423363e` | 26831 | yes | `plugin/initialize` → `ok:true` agentId `claude-code` |
| Codex | 5/5 then 8/8 after stdio client | after client `7d7df948dbfc924d15c9195352401d6ad621c56243887cde2534e3531138ea81` | 24092 | yes (pre-client `18808f2d…` / 17684) | `plugin/initialize` → `ok:true` agentId `codex` |

`piwin.json` digest/bytes match `dist/agent.mjs` after each rebuild.

### BUILD-03 required lane

```sh
# ordinary core tests, no env: skip staging, vendor check still runs
pnpm --filter @piwin/host-runtime exec vitest run \
  src/testing/external-backend-artifacts.test.ts \
  src/extension-claude-codex-staging.integration.test.ts \
  src/extension-claude-local-binary.integration.test.ts
# 6 passed / 7 skipped

PIWIN_REQUIRE_EXTERNAL_BACKENDS=1  # no paths → exit 1
# missing PIWIN_CLAUDE_BACKEND and PIWIN_CODEX_BACKEND

PIWIN_CLAUDE_BACKEND=/tmp/piwin-missing-claude \
PIWIN_CODEX_BACKEND=/tmp/piwin-missing-codex  # exit 1
# missing piwin.json in /tmp/piwin-missing-claude

PIWIN_REQUIRE_EXTERNAL_BACKENDS=1 \
PIWIN_CLAUDE_BACKEND=/Volumes/BigDisk/Developer/piwin-claude-code-backend \
PIWIN_CODEX_BACKEND=/Volumes/BigDisk/Developer/piwin-codex-backend \
pnpm --filter @piwin/host-runtime exec vitest run \
  src/testing/external-backend-artifacts.test.ts \
  src/extension-claude-codex-staging.integration.test.ts
# 11 passed, including 5 staging cases
```

`pnpm --filter @piwin/host-runtime typecheck` exit 0.

### Claude CC-02 / CC-03 (injected query port)

`pnpm test` in Claude repo: 10 files, 17 tests, exit 0.
New file `test/plugin-load-resume.test.ts`.

### Codex CX-01 / CX-02 process layer (fake executable)

`pnpm test` in Codex repo: 6 files, 8 tests, exit 0.

- `test/app-server-stdio.test.ts`: start response before delayed `turn/completed`
- `test/production-entrypoint.test.ts`: `dist/agent.mjs` `session/new` → `thr_fake`, not the stub error

## Continuation (no commit, this session)

Desktop split-pane TUI no longer hardcodes Pi/Grok. `canRenderSessionTuiPane` uses
Pi embedded TUI or Host-advertised `nativeCli`. Host skips empty `backendSessionId`
and persists a real vendor id from `session/started`. Claude `session/new` returns
an unbound draft (`""`); load/resume of missing/synthetic `cc-<host-id>` fails.
Codex load without a thread id fails instead of `thread/start`. Capability tables
mark unimplemented catalog/media/mode ops as unsupported.

Artifacts after this continuation:
- Claude `dbb1c0050dca15236a927ca100d2c08fa2f55e681c3f0d2abdd3265e1d38dc72` 34160B
- Codex `2def594b7c8d2ac967d4617620779139fc22541a3fcf4011aa3c4dbaabdd2813` 31080B

History reconstruction (this slice): Claude `session/load` reads
`~/.claude/projects/<encoded-cwd>/<id>.jsonl`; Codex reads
`~/.codex/sessions/**/rollout-*-<id>.jsonl` before `thread/resume`.
`catalog/native-observe` is file-only. Missing jsonl → `unavailable`.

Mock/BYOK (no Claude account): production artifact spawns a fake stream-json
CLI (`test/fixtures/fake-claude.mjs`) and returns `MOCK_OK`. Image attachments
are Host media refs forwarded by `buildExternalAgentPrompt` and encoded as
Claude `image` blocks, never path/base64 in prompt text. Real CLI still
inherits `ANTHROPIC_API_KEY` when present (BYOK). Artifact `499b4f0d…` 36098B.
Verified: Claude 28 tests; host-runtime executor 2 + typecheck. Not committed.

Human-input UI (this slice): Desktop mounts `BackendUserInputPrompt` on
`session/backend-input-request`; TUI answers a single text/select by original
choice id; one-shot `piwin chat` cancels with an explicit Desktop/TUI route.
Desktop+CLI typecheck green; hook/prompt/permission/cli tests 75+12. Still not
committed. Codex vendor binary remain blocked/not-run.

### P6 Claude real-provider (this slice, not a full P6 candidate)

Authorization: Claude CLI `2.1.281` oauth_token firstParty; model `haiku`;
max 2 prompts; tools denied (`reject_once`); disposable `/var/folders` cwd.
Not a readiness probe; sentinels only.

1. `session/new` then prompt A → native id `17fe19de-7ffc-4a69-958a-44f745f9c1a3`,
   assistant text `PIWIN_CC_P6_A`, `status: completed` / `stop`. No tool callbacks.
2. First `session/load` failed: Claude stores jsonl under the **realpath**
   (`-private-var-folders-...`), plugin encoded `/var/folders` without resolving.
3. Fix: `encodeClaudeProjectDir` uses `realpathSync`. History tests 4/4;
   plugin tests 29/29. Artifact `f9d68bda…` 36197B.
4. Plugin restart `session/load` of that exact id: replay contained A; jsonl
   contained A. Prompt B → `PIWIN_CC_P6_B YES_SAW_A`; jsonl then contained B.
   Temporary project dir deleted after capture.

Not-run: Desktop/native PTY UI, remote Host, Codex, image L5, allow-tool file
oracle, browser E2E. Do not treat this as P6 candidate pass.

### Marketplace listing (this slice)

Claude Code is an independent extension, not a bundled adapter.
`AGENT_CATALOG` in core stays empty. Source repo:
https://github.com/mimimaster/piwin-claude-code-backend (`e2d8319`, public).
Catalog PR: https://github.com/mimimaster/piwin-extensions/pull/15
(`mimimaster/claude-code` 0.1.0, `validate-entry.mjs` pass, catalog `npm test`
50/50). Live `extension.piwinwin.com` listing waits on merging that PR
(protected main). Codex is not listed.

## Remaining / blocked

- P2 Claude: SDK-vs-CLI README discrepancy; `plugin.ts` split; synthetic `cc-<host-id>` persistence
- P3 Codex: real CLI schema/handshake (PATH binary unusable); bound UTF-8/backpressure soak; interleaved sessions; interrupt vs delayed terminal
- P4 capability surface per plugin
- P5 Host/Desktop/CLI integration beyond staging
- P6 real native/provider acceptance and browser E2E (Codex computer-use MCP is available for that gate, not used here)
- Plugin git: still unborn until local checkpoints are created; do not push
- Core working tree still has unrelated appearance edits; do not mix them into this slice
