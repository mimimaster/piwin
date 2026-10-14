# Local Claude Code structured-transport verification

Status: parent-workspace checks and independent background verification both passed. Tester run `01866bfc-f6e6-4251-8851-97f9784dc010` independently confirmed native CC 2.1.281, syntax/runtime exit 0, all 17 assertions, eight mock requests and completed cleanup. This is prerequisite research, not an implemented/released backend or Desktop UI acceptance.

## Environment and commands

User-owned executable: `/Volumes/BigDisk/npm-global/bin/claude`. Native version checked in this session: **2.1.281**.

```sh
node --check docs/evidence/cc-local-transport-probe.mjs
node docs/evidence/cc-local-transport-probe.mjs
```

Both exited 0 in the parent workspace. The standalone harness accepts `CC_PROBE_BIN` to override the executable explicitly. It uses only Node built-ins, no installation.

## Observed results

All 17 assertions passed:

1. Initialization returns nonempty command/model catalogs.
2. Initialization sends no inference request to the fixture API.
3. Idle interrupt request returns success.
4. Real partial text events contain the exact fixture text (two deltas); final result independently matches.
5. CLI emits a native session id.
6. Deny path emits a real native `can_use_tool` request with request/tool ids.
7. Denied tool turn completes under the same session.
8. Denial prevents the command's output file from existing.
9. Allow path emits a real native `can_use_tool` request.
10. Allowed tool turn completes under the same session.
11. Approval actually executes the harmless command: isolated output file contains exactly `CC_TOOL_PROBE_OK\n`.
12. Inference held without `message_stop` is disconnected by native interrupt, before the fixture performs any manual release.
13. Same native process accepts a subsequent turn with exact recovery text under the original session id.
14. Terminating and restarting with `--resume <native-id>` retains exactly that id.
15. Resumed inference input includes the previous user sentinel AND previous assistant answer AND the new resume sentinel.
16. All eight mock inference fixtures are consumed, with no unexpected fallback.
17. No mock handler errors.

Parent stdout:

```json
{"ok":true,"checks":["initialize catalogs","initialize sends no inference","idle interrupt receipt","real partial text deltas","native session id","deny real approval request","deny turn completion","deny prevents command write","allow real approval request","allow turn completion","allow executes command","interrupt aborts unfinished inference","same-process recovery","resume exact native session id","resume retains prior user and assistant history","all mock fixtures consumed","no mock handler errors"],"facts":{"commands":43,"models":6,"partialTextDeltas":2},"errors":[],"modelRequests":8}
```

An earlier zero-prompt control-only probe against the same binary returned 43 commands and 5 models. The isolated mocked-provider fixture returned 6 models. Catalog results depend on native runtime environment; they are not fixed product constants or promises about account entitlements.

## Boundary and safety

The harness runs CC with isolated temporary HOME, cwd and `CLAUDE_CONFIG_DIR`; `--bare`, `--safe-mode`, empty settings sources and empty strict MCP configuration; sanitized environment and telemetry/background-traffic suppression. It does not load real user configuration/credentials or offer login. The only inference endpoint supplied is a loopback server with a synthetic API key. The fixture model id does not select a real provider call.

The command approval fixture uses `printf` redirected into a temporary file, because unredirected `printf` was automatically allowed by native CC. Approval proof is native control requests plus actual file absence/presence, not fabricated ACP events or model text. The harness removes its own temporary data and closes its native child processes and server.

The control-only probe uses public stream-json flags plus native `--await-initialize` and `control_request` envelopes. These control messages are SDK/internal interfaces, not a public stable standalone CLI RPC guarantee. Scout advice to use `--no-telemetry` was not adopted: bounded native-binary spot-check found no such token. The successful probes use environment flags instead. No raw account metadata or headers are printed.

## What remains unverified

- Real subscription/API/provider authentication and inference; none was requested in these probes.
- Preservation of arbitrary user settings, hooks, plugins and MCP: intentionally disabled in fixtures for safety. Production must explicitly preserve user-owned configuration under the chosen SDK/CLI connection path.
- Actual TypeScript SDK/ACP runtime invocation. Official TypeScript SDK documentation exposes `pathToClaudeCodeExecutable`; this permits targeting a separately installed CLI, but the SDK itself was not installed or run here.
- Interactive PTY/fullscreen CC and Desktop/native-view switching, writer ownership, Desktop rendering, remote Host and Windows/Linux.
- Image input, user dialogs/MCP elicitation, long history streaming, usage mapping, fork/compaction/undo semantics.
- Codex remains blocked by the previously observed missing local platform executable; no repair/install attempted.

## Implementation implication

Local CC structured connection is technically feasible on the tested version. Prefer a version-pinned documented SDK wrapper explicitly pointing to the user-owned executable for production; raw control probes are feasibility evidence, not a reason to promise arbitrary CLI-version compatibility. ACP remains optional and adds a separate mapping layer. Neither choice should implement subscription selection, new login flows or silent bundled-binary substitution.

Official reference: https://code.claude.com/docs/en/agent-sdk/typescript (local executable override, streaming Query control methods and session helpers).
