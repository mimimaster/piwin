# Claude / Codex plan execution — step 1 checkpoint

Plan: `plan-mv4ycxso`, displayed as `plans/session-mv4uvqd3-1civndwe.md`.

## Delivered scope

Step 1 contracts and direct remote transport admission validation are applied. No Claude/Codex adapter, Host handoff state machine or Desktop UI feature has been implemented.

- Generic bounded external `AgentCliOpenInput`, strict shape gate, ownership and failure types.
- Optional native CLI capabilities: absent means unsupported; Pi TUI remains separate.
- Additive plugin `session/cli-launch` and `input/request` methods with negotiated Host flags.
- Strict pure launch descriptor and typed native user-input parsers, tests and public exports.
- Remote command admission rejects client executable/argv/cwd/environment overrides.
- ADR 0082 explicitly documents this as staged contracts rather than shipped runtime/UI.

Owning sources: `packages/contracts/src/agent-cli.ts`, `agent-plugin-cli-launch.ts`, `backend-user-input.ts`, `agent-backend-capabilities.ts`, `external-agent-status.ts`, `agent-plugin-protocol.ts`, `index.ts`, related colocated tests, and `packages/host-server/src/remote-command-validation.ts` / `remote-agent-cli.test.ts`.

## Review and parent verification

Independent review approved exact candidate `subagent-result-a8532b8e-c6fa-4b57-a8c0-b42a65bc9198-987cef0e-f7aa-49aa-bd56-6e6e5e27c490`, revision 1.

- Review: `32f94df8-7bed-4720-923f-9d3c96aad5ae`, revision 1.
- Apply operation: `9e92f785-20f0-4953-81bb-dd1eb1c3a7de`.
- Parent verification: `87c29538-d888-4f07-9161-aaf504092a6f`, passed.

Fresh commands after apply:

| Command | Actual result |
| --- | --- |
| `pnpm --filter @piwin/contracts test` | Exit 0; 106 files, 822 tests passed |
| `pnpm --filter @piwin/host-server exec vitest run src/remote-agent-cli.test.ts` | Exit 0; one file, two tests passed |
| `pnpm typecheck` | Exit 0; 33 workspace projects completed |
| `pnpm test:architecture` | Exit 0; Package boundaries OK |

The reviewer additionally inspected security and compatibility cases. No new dependencies. Largest new production file is `backend-user-input.ts`, 331 lines. A non-blocking indexed-loop non-null assertion was noted by the reviewer; its bounds are checked in that loop.

Step 1 marked done only after these parent checks. Background tester run `ca0a5fbc-31e4-47ae-9cfe-2fb7d048edac` subsequently completed with verdict **pass**, independently reproducing all commands above plus contracts typecheck. Its external-id probe returned Grok/Claude/Codex accepted, Pi rejected, and Pi native CLI capability false. These are syntax/capability checks, not proof that a backend is installed or trusted.

Tester noted a non-blocking coverage gap: duplicate choice IDs and duplicate selected-option IDs are rejected by the parser but lack direct test assertions. Track these cases for the next native-input test slice rather than claiming direct coverage. Runtime launcher, callbacks/UI and vendor adapters remain unimplemented. No repeat test run was needed to incorporate this report.

## Step 2 baseline blocker and resolution

After the user authorized a local checkpoint, step 1 was committed alone as `09149618` (`feat(contracts): define native agent CLI and input interfaces`). No push was performed; the two unrelated local transport-probe files were excluded. New writer run `443f3571-aa82-434d-b503-5b7e81f9918d` was explicitly delegated from `main` with the committed prerequisites. Step 2 subsequently passed review after one repair, was applied and verified in the current parent; see `docs/evidence/cc-codex-step2-host-handoff.md` for exact evidence and the initial default-worker timing-sensitive test failure.

Historical blocker: writer run `df6b7cee-3c82-4554-9ee3-b51e43e489bb` stopped with no changed files. Its isolated worktree is based on Git tip `0175d70bab4d1a2a044a673f283a560248319ccf`, which does not contain the applied-but-uncommitted step 1 contracts in the parent worktree. It cannot safely implement dependent step 2 without that baseline.

At that time, step 2 returned to pending with the blocker recorded; no silent retry or duplicate contracts were performed. The subsequent user-authorized checkpoint resolved the missing-baseline prerequisite, and step 2 is active again. No stashes, dependency installation, pushes or out-of-scope edits were performed.

Steps 3/4 also require user-confirmed external plugin repository locations. Codex real-machine acceptance additionally requires a working native executable; its existing ENOENT was not repaired.
