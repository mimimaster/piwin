# Grok historical replay exceeds the plugin frame limit

Status: root cause reproduced; plan step 1 (Host/contracts) implemented and verified. Independent adapter producer and real-history acceptance remain pending.

## Target and safe probe scope

- Product session: `session-mutwmch2-a4w6i89h`.
- Native Grok session: `01a10746-0b83-7923-a192-10704dfa70ca`.
- Native CLI: `1.0.46`.
- Installed adapter revision: `54f463f20a0dfd863dbe129b0e133b25aefd44ca3920eb612b8b238b86cd8a67`.
- Adapter source locator: `https://github.com/mimimaster/grok-build-acp`, commit `b6e09c7664004f83f02d3a6ed29cf97085145861`.
- Probes only initialized and resumed/loaded the existing native history through an isolated adapter process. No model prompt, model/effort change, dependency installation, or history deletion was performed. Native resume/load can update vendor activity metadata.

## Fresh observations

Read-only SQLite queries against this product session's `transcript.sqlite3` found:

| Sequence | Role | Text | Attachments/context refs |
| --- | --- | --- | --- |
| 268 | assistant | Previous completed reply, 1,637 characters | Existing historical turn |
| 269 | user | Complaint, 14 characters including U+FFFC | None |
| 270 | user | Zero characters | None |
| 271 | user | `test`, four characters | None |

No subsequent assistant row existed. Native Grok history contained only the original user turn, not these follow-up prompts. The empty card is an empty stored user row; its submission origin is not established, and it is not evidence of an empty model completion.

1. An isolated `session/resume` probe succeeded in 1,161 ms and returned the same native session id with zero replay events.
2. The same history requested with `session/load` through the real current `AgentPluginBridge` failed in 583 ms:

```text
bridge closed: agent-plugin-protocol-error: invalid frame size or framing
AgentPluginBridgeError:
agent-plugin-protocol-error: invalid frame size or framing (in flight: session/load)
```

The diagnostic command subsequently reached its 75-second outer timeout. Its native probe process was checked afterward and was no longer running. This is a failed reproduction, not a passing verification.

3. A second, independently scoped adapter probe measured the unmodified `session/load` response without printing history contents:

```text
elapsedMs: 670
ok: true
bytes: 2711190
limitBytes: 2097152
overLimit: true
replayEvents: 1826
backendSessionId: 01a10746-0b83-7923-a192-10704dfa70ca
```

That adapter acknowledged `plugin/dispose` and exited with code 0. No prompt was sent.

## Causal path

- `packages/contracts/src/agent-plugin-protocol.ts` defines `AGENT_PLUGIN_MAX_FRAME_BYTES = 2 * 1024 * 1024`.
- `packages/contracts/src/agent-plugin-frame.ts:54-56` rejects a UTF-8 frame above that limit.
- `packages/host-runtime/src/agent-plugin-bridge.ts:194-203` closes the bridge on that parser error; pending `session/load` fails before the external turn can dispatch its prompt.
- The installed adapter's `source/packages/agent-grok/src/plugin-server.ts` returns all `opened.replayEvents` inside one open-session response. The deployed `source/dist/agent.mjs:3707-3763` does the same. Many individually valid events therefore become one oversized response.
- `packages/host-runtime/src/grok/grok-session-router.ts:83-96` chooses `load` when native catalog activity is newer than the binding's replay sync time. This session's stored sync time was the initial prompt time; subsequent native activity makes historical replay eligible.
- `packages/host-runtime/src/commands/external-agent-turn-executor.ts:37-67` persists the user row before activating the external runtime, then calls `prompt` only after activation succeeds. This explains why a user card can exist without a native follow-up prompt.

The parser limit is functioning as designed. Packing unbounded history into a single frame is the incompatibility. Increasing the global frame limit or hiding empty cards does not establish a durable repair.

## Repair boundaries and acceptance

1. Negotiate streamed historical replay at the generic Host/plugin contract. Reuse ordered, session/generation-scoped agent emissions; keep each frame under the existing limit. Host must collect replay while session open is pending, validate completion/count, and replace the product projection only after successful complete replay. Keep legacy array responses compatible.
2. Fix the producer in the independent Grok adapter repository, not this monorepo and not its immutable installed revision. When streaming is negotiated, emit replay events in bounded frames and return a small setup response. Single-event overflow must fail explicitly, not silently truncate history.
3. Exercise failed activation, invalid/oversized frames, and interrupted replay. Preserve existing history and persist a visible failure. A protocol-close path must dispose its owned adapter process rather than skip cleanup because `closed` is already true. Do not kill unrelated Grok processes.
4. Verify the same large native history loads through the real Host bridge without a model prompt, then use an explicitly approved isolated prompt smoke test for end-to-end submission. Run touched-package tests and root typecheck before claiming a fix.

Existing unrelated working-tree edits in Desktop backend controls, their tests, `transcript-empty-stage.css`, and ADR 0082 are not part of this investigation and must be preserved.

## Step 1 verification (2026-10-05)

- Added additive `hostCapabilities.replayStreaming` negotiation and `streamedReplayEventCount` completion metadata, without changing protocol version or the 2,097,152-byte limit.
- Added provisional collection during `session/load`, count/mode/closed-state validation, and legacy inline replay compatibility. Completed replay still goes through the existing ordered media import/projection path.
- Added response method/scope correlation and idempotent owned-child disposal after protocol closure; graceful EOF precedes bounded SIGTERM/SIGKILL escalation.
- The new regressions first failed against the original Host (missing negotiation, cleanup skipped after closure, and foreign responses accepted), then passed after the fix. An oversized test fixture was corrected to use an actual oversized JSON response rather than a whitespace-only line, which the original bridge deliberately ignores.
- `pnpm --dir packages/contracts exec vitest run src/agent-plugin-protocol.test.ts`: 9 passed.
- Focused Host suites (`agent-plugin-bridge`, `agent-plugin-session`, `agent-plugin-control`, `agent-plugin-usage.integration`, `agent-plugin-media`): 67 passed across 5 files. Includes 1,826-event aggregate replay above 2 MiB, invalid/missing counts, wrong session/generation/method, interrupted/empty replay, preserved media proposals, concurrent dispose, unanswered dispose acknowledgement and a stubborn child with another adapter remaining usable.
- `pnpm --filter @piwin/contracts typecheck` and `pnpm --filter @piwin/host-runtime typecheck`: passed.
- Root `pnpm typecheck`: passed for 32 workspace projects (root script excludes Mobile).
- Full `pnpm --filter @piwin/contracts test`: 732 passed across 95 files.
- Full `pnpm --filter @piwin/host-runtime test --reporter=dot`: 3,828 passed across 438 files (the package runner used its default reporter), including external backend media/options and Grok adapter lifecycle integration.
- Contract guide: [agent-plugin-streamed-replay.md](../guides/agent-plugin-streamed-replay.md); the architecture package map references it.
- `git diff --check`: passed. Touched production files are 152, 356, 371, 36 and 38 lines, all below the 1,000-line cap.

Independent source checkout located at `/Volumes/BigDisk/Projects/Projects/grok-build`, origin `git@github.com:mimimaster/grok-build-acp.git`, HEAD `b6e09c7664004f83f02d3a6ed29cf97085145861`. It already has unrelated usage-feature edits, including `plugin-server.ts`, its contract shim, `dist/agent.mjs`, and `piwin.json`; do not overwrite or rebuild that dirty checkout. Preparing a separate producer worktree is the next explicit gate. No installed extension, session binding or native history has been migrated or deleted, and no model prompt has been sent.
