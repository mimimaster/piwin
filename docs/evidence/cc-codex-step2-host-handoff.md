# Claude / Codex — step 2 Host checkpoint

Plan `plan-mv4ycxso`: step 2 completed after independent review, one authorized repair, apply and fresh parent verification. External plugins and Desktop/attached-CLI UI integration are not implemented by this checkpoint.

## Delivered

- Host-owned `desktop` / `native` / `switching` writer state; synchronous native reservation and prompt pre-registration checks, plus queued-turn pause/retry/drain.
- Generic plugin `session/cli-launch` descriptor, verified Host binary, trusted cwd and exact persisted native ID; explicit legacy Grok compatibility only.
- Structured actor suspension before native PTY launch; confirmed PTY exit and history import before returning ownership to Desktop.
- Failed suspension, exit confirmation or history import cannot silently unlock the session; reconnect retains native ownership until handoff.
- Native input request/response/settlement contracts and transport admission; bounded pending tickets bound to session, generation and active Run; lifecycle cancellation and stale-answer rejection.
- Native questions do not inherit the short intervention callback timeout and are not Host remembered permission rules.
- Named ownership/input modules, direct integration regressions, exports, push audience/policy and staged ADR 0082 update.

Touched owning packages: contracts, host-runtime, process, host-server and host-transport. No vendor adapter, new dependency, account/login setup, Codex binary repair or release publication.

## Review lineage

The initial writer used committed step 1 baseline `09149618` after user authorization. The first step 2 candidate was not applied: review `7e81e164-051d-4a0f-aa2a-81786253ddf3` requested four repairs.

1. Failed suspension during history refresh had returned success, incorrectly unlocking Desktop.
2. Failed suspension before PTY spawn had been ignored.
3. Input without an explicit run ID had been admitted without an active Run.
4. Generation-scoped input cancellation needed actual disposal/detachment wiring.

A reviewed continuation reproduced these failing branches and repaired them with regression tests. The repaired exact result was independently approved and applied:

- Result: `subagent-result-d94db0b6-fb78-4f1d-85b0-1c7807689174-3a5f5cd8-e175-4e23-a68f-0c4db112c270`, revision 1.
- Review: `037536a0-f801-4d31-8e80-baf8ca4ea3cb`, revision 1.
- Apply operation: `1b6b5e5c-e05e-4c26-b9d8-c09aec9fe040`.
- Parent verification: `b58ea927-8436-428d-9b75-175ec12e3344`, passed.

## Fresh parent verification

| Command | Actual result |
| --- | --- |
| `pnpm --filter @piwin/host-runtime exec vitest run --maxWorkers=4` | Exit 0: 465 files, 3983 tests |
| `pnpm --filter @piwin/process test` | Exit 0: 8 files, 111 tests |
| `pnpm --filter @piwin/contracts test` | Exit 0: 107 files, 823 tests |
| `pnpm --filter @piwin/host-server exec vitest run src/remote-agent-cli.test.ts` | Exit 0: one file, two tests |
| `pnpm --filter @piwin/host-transport test` | Exit 0: 9 files, 71 tests |
| `pnpm typecheck` | Exit 0: 33 workspace projects |
| `pnpm test:architecture` | Exit 0: Package boundaries OK |
| Scoped `git diff --check` and production line counts | Exit 0: 29 production files, maximum 796 lines |

The first default-worker Host suite was **not green**: one existing inline-plan test failed its one-second terminal-push assertion (3982 passed, one failed). Its exact isolated test then passed, and the full suite passed with four workers, without source changes to that test. This supports a timing-sensitive failure under concurrency; no deterministic root cause or default-worker stability fix is claimed.

The parent Git tip and unrelated Desktop artifact files changed concurrently while delegation was running. Those unrelated edits were not committed, overwritten or treated as this slice's UI work. The merged current parent was verified, hence its test counts differ from the isolated candidate's 464 files / 3979 tests.

Background tester `e90beed7-7c98-4f47-a8f1-f6e3427bd760` completed with verdict **pass**. It verified workspace snapshot HEAD `16bdaf8a` includes the applied step 2 modules, rather than testing old main. Its fresh focused checks all exited 0:

- Host ownership, generic CLI and input lifecycle: five files / 18 tests. The positive CLI case exercises real `HostRuntime` plus the fixture plugin's `session/cli-launch`, exact stored native ID, Desktop writer exclusion, concurrent handoff deduplication and suspension-denied recovery.
- Process exit confirmation: one file / two tests, including SIGKILL exit wait and retained terminal entry on unconfirmed exit.
- Native-input / CLI contracts: three files / nine tests.
- Remote CLI admission: one file / two tests.

Total: 31 focused tests passed. These are independent focused results, not another full-package/root run, nor evidence of a real vendor plugin or visible Desktop UI. No covered work was rerun merely to acknowledge the report.

The tester identified two remaining coverage gaps: a positive native human-input callback roundtrip through the plugin bridge and real Host wiring; and Host-level unexpected PTY exit / disconnect followed by failed history import retaining ownership. Existing input controller/disposal and process exit tests do not replace those end-to-end cases. Carry these gaps into the integration and final acceptance work; no new fix or complete coverage claim is made here.

## Remaining work

Steps 3 and 4 need user-confirmed independent plugin repository paths before writes. Step 5 UI and step 6 installation remain pending; step 7 real dual-surface/vendor verification is unperformed. Codex's existing missing platform executable remains unresolved. No native vendor, browser DOM or visual screenshot proof is claimed here.

For dependent worktrees, the Host-frozen result ref `refs/piwin/results/subagent-result-d94db0b6-fb78-4f1d-85b0-1c7807689174-3a5f5cd8-e175-4e23-a68f-0c4db112c270` resolves to candidate snapshot `b3339b5a416d9b197c9d45846867f125836ede72`; normal `main` alone does not yet include the applied step 2 source changes. Step 2 source has not been separately committed or pushed.
