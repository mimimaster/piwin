# Local Claude / Codex discovery

User requested automatic local discovery rather than asking them to supply existing paths. This was a read-only search: no installation, binary repair, provider calls, authentication/config/history access, new repository or plugin code changes.

## Executables verified here

- Claude PATH: `/Volumes/BigDisk/npm-global/bin/claude`.
- Claude resolved executable: `/Volumes/BigDisk/npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
- `claude --version`: exit 0, `2.1.281 (Claude Code)`. This proves the executable launches, not SDK integration, login or model access.
- Codex PATH: `/Volumes/BigDisk/npm-global/bin/codex`.
- Codex resolved launcher: `/Volumes/BigDisk/npm-global/lib/node_modules/@openai/codex/bin/codex.js`.
- `codex --version`: exit 1, ENOENT for `/Volumes/BigDisk/npm-global/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex`. No repair was attempted.

## Source / plugin findings

- Existing Codex source checkout: `/Volumes/BigDisk/Projects/Projects/_refs/codex`, HEAD `20440a0`. Contains `codex-cli` and `codex-rs`. Conventional root and `codex-rs` target/debug and target/release `codex` executables do not exist; no build was attempted.
- Existing OpenClaw Codex plugin: `/Volumes/BigDisk/Projects/Projects/openclaw-official/extensions/codex`. Its named package manifest declares `@openclaw/codex` 2026.5.8 and OpenClaw plugin dependencies, not a piwin sessionBackend. It is a possible reference, not an installed/compatible piwin adapter.
- Local piwin catalog repository: `/Volumes/BigDisk/Developer/piwin-extensions`. Its mimimaster catalog entries are commandcode-provider, grok-build-acp, kiro-provider and session-importer; no Claude/Codex entry was found there.
- Selected installed extension manifests were checked, without importing artifacts: the only declared sessionBackend is `grok` (`piwin-agent-stdio`). No selected Claude/Codex sessionBackend was found.

Directory-name discovery covered `/Volumes/BigDisk/Developer` and `/Volumes/BigDisk/Projects/Projects` through depth 3 (999 directory metadata entries). HOME Projects is the same project collection. Git internals, node_modules, caches, build targets, credential directories and user histories were excluded from that traversal. This is bounded discovery, not a claim that no other repository exists anywhere on the machine.

## Approved locations and execution blocker

Existing local native CLIs are not the same as the two independent piwin adapter source repositories required by steps 3/4. No matching independent adapter source was located in the checked roots/inventory. The user subsequently approved creating these explicit repositories and continuing subagent-driven execution:

- `/Volumes/BigDisk/Developer/piwin-claude-code-backend`
- `/Volumes/BigDisk/Developer/piwin-codex-backend`

The current Host tools cannot initialize them from the core project's scope. Attempts to write only README, AGENTS and gitignore metadata at each approved path were rejected with `path escapes repository`. Subsequent readonly existence checks confirm both directories and all six files do not exist. No shell writes, symlink workaround, vendor staging in core, Git initialization or plugin implementation followed the rejection.

Existing subagent routing also resolves the worktree repository from the parent session, not an arbitrary task path: `packages/host-runtime/src/host-runtime-subagent.ts` resolves `task.parentSessionId` through `resolveSubagentParentLocation`; `subagent-start-tool.ts` supplies the current parent session ID and exposes no target-project override. No orchestration scheme is active this turn. A writing child from this core session would therefore not provide the required external-repository isolation.

Unblock by creating/opening the approved independent Git repository as a piwin project session before dispatching its writing child. Path approval is complete and does not need to be asked again. Steps 3/4 remain pending; no implementation tests ran or acceptance was claimed. Do not expand scope by changing the Host tools themselves to work around this limitation.

Do not modify the vendor installation or existing Codex reference/OpenClaw repositories to implement piwin adapters. Do not install or repair Codex without separate approval. Claude can target the discovered local executable; Codex fixture work can use the local source as a protocol reference, but real native smoke remains blocked by the missing platform executable.
