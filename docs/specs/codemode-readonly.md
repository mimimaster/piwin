# Read-only Codemode

Status: accepted. Normative companion to [ADR 0087](../adr/0087-readonly-codemode.md).

## Registration

- Config module: `packages/contracts/src/codemode.ts`. Default `enabled: false`.
- Tool name: `piwin_codemode`. Family: `codemode`. Permission action: `codemode:run`. `readOnly: true`. File effect: `none`.
- Absent when disabled, when the session port is absent, or when the compiled manifest excludes the family.
- SDK `customTools` and RPC proxy tools are derived from that manifest. No second executor.

## Host context

Nested `HostToolExecutionInput` must carry the active `sessionId`, `runtimeGenerationId`, admitted `runId`, a new generation-normalized `toolCallId`, and `scriptInvocation`. The model argument object cannot set those fields. Worker frames must not be spread into `scriptInvocation`.

`scriptInvocation.admittedToolNames` is the host allowlist for that invocation. Dispatch denies any other Host name before `prepareArgs`.

## Read-only rule

Admit a Host target only when all of these hold:

- `permissionSpec.readOnly === true`
- family is `filesystem-read`, `web-search`, `web-fetch`, `notes-read`, or `flashcards-read`
- action is one of `filesystem:read`, `filesystem:list`, `network:web_search`, `network:web_fetch`, `notes:note_list`, `notes:note_search`, `notes:note_read`, `knowledge:knowledge_list`, `knowledge:knowledge_search`, `knowledge:knowledge_read`, `flashcards:list`
- `fileEffect` is omitted or `{ kind: 'none' }`
- the name is in `admittedToolNames` and in the frozen generation surface

`piwin_toolbox` may be called as the discovery shell. Its target is checked with the same rule. A read-only shell registration is not enough.

MCP script calls require `annotations.readOnlyHint === true` on the live listing. Search and describe apply the same hint filter. Ordinary MCP calls do not.

## Structured results

`ToolResult.scriptPayload` is optional. When present, a script consumes `structuredContent` and `isError` before any chat truncation. Do not `JSON.parse` tool text to fill it. Do not copy it into model content, transcript details, or JSONL. Nested tool errors reject inside the script.

## Engine

One `CodemodeSandbox` per invocation. Pass the configured deadline and memory cap, an empty `store`, and the caller signal. Close the sandbox in `finally`. Do not persist `storeWrites`. Do not expose image or classifier globals.

## Packaging

`scripts/bundle-host.mjs` externalizes `@earendil-works/pi-codemode@1.1.0`. After prune, the worker file and `quickjs.wasm` must exist and a sandbox execute must return the echoed value. Pi packages in the bundle stay at 0.84.2.

## Dual-backend acceptance evidence (GAP-001)

```sh
pnpm --filter @piwin/host-runtime exec vitest run src/codemode/codemode-backend.e2e.test.ts
pnpm --filter @piwin/host-runtime --filter @piwin/agent-host typecheck
pnpm test:architecture
```

Verified: 12 tests passed; both package typechecks and package boundaries passed. The test-only loopback OpenAI SSE endpoint scripts a model tool call through the production SDK session factory or an actual spawned RPC worker (default source worker entry, JSONL). Both use the real restricted SessionHostToolExecutionPort and CodemodeSandbox. Config on/off is compiled into the final manifest and checked in actual HTTP model requests. A >120k on-disk read-only structured fixture produces `[1998,1996,1994]`; parent/nested generation-normalized IDs, Run binding, structured-payload non-leakage, script/tool errors, and prompt abort reaching Host without starting a queued read are asserted. Backends, HTTP connections, temporary files and generation surfaces are disposed in `finally`.

The child test reproduced an internal/product session-ID mismatch in RPC abort: parent tool controllers were not cancelled until the sandbox deadline. The minimal fix uses the product session alias for abort, matching parent controllers; the worker already accepts that alias. Cancellation is asserted within 2s, before the 15s deadline. Pi 0.84.2 currently classifies mid-tool abort as a failed prompt with “This operation was aborted”; the test records that behavior, not an `aborted` prompt-outcome claim. This evidence uses fixture reads, not live providers/MCP or a packaged worker. Existing Codemode integration/MCP checks (3 tests) and adjacent backend conformance/worker lifecycle/client checks (30 tests) also passed; no full-suite or bundle rerun is claimed for this slice.
