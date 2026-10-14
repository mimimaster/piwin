# Step 7 dual-view acceptance — pass / blocked / unverified

Date: 2026-10-13. No marketplace or Desktop release.

## Pass (this environment)

| Item | Evidence |
| --- | --- |
| User-owned Claude CLI | `claude --version` → `2.1.281`, path `/Volumes/BigDisk/npm-global/bin/claude`, not an SDK platform package |
| Plugin `check()` + Host `session/create` | `extension-claude-local-binary.integration.test.ts` 1/1 pass; `agents/status` `ready`; binaryPath has no `claude-agent-sdk-` |
| Plugin stdio one-turn + mock Anthropic | `piwin-claude-code-backend/scripts/local-text-smoke.mjs` `ok:true`; nativeId `b7fdad22-3816-4a02-8adf-b0600b2f6533`; `session/cli-launch` args contain that id; no `executable`/`env` |
| Partial text mapping | smoke frames contain `CC_PLUGIN` + `_SMOKE` |
| Independent install | staging 5/5 still pass after rebuild |
| Codex missing binary is not repaired | wrapper exists; `codex --version` ENOENT vendor; rebuilt plugin `check()` → `not-installed` |
| Host typecheck / architecture | host-runtime `tsc --noEmit` exit 0; `pnpm test:architecture` OK |

## Blocked

| Item | Why |
| --- | --- |
| Codex app-server / dual-view | `/Volumes/BigDisk/npm-global/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex` ENOENT; plan forbids repair |
| Real Anthropic/OpenAI provider | smoke used loopback mock `ANTHROPIC_BASE_URL`; no paid/live model request |
| Desktop UI ↔ native CLI same-session visual | workbench browser is `about:blank`; no delivered Desktop screenshot / DOM of two surfaces |
| Remote Host | not in this run |
| Independent reviewer + after-apply tester | no parent apply of a step-7 candidate; plugin repos are outside Host worktrees |

## Unverified

| Item | Why |
| --- | --- |
| Long replay / images / Host permission UI / active cancel recovery through Desktop | not exercised beyond plugin mock 17-check-equivalent and one-turn smoke |
| Attached CLI `piwin` shell switch | not run |
| Bundle / Desktop installer | out of plan scope |

Claude plugin now spawns the user CLI (`stream-json`) instead of throwing “SDK not bundled”. First prompt does not pass a synthetic `--resume`. Codex `check()` probes `--version` so a wrapper-only path is `not-installed`.
