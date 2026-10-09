# Read-only Codemode

Codemode lets a model run one JavaScript script that calls already admitted read-only tools and returns a small result. It is off until `codemode.enabled` is true. There is no settings page for this slice; edit the Host config and let the runtime generation reload.

## Config

```json
{
  "codemode": {
    "enabled": true,
    "timeoutMs": 30000,
    "memoryLimitBytes": 67108864,
    "maxCalls": 32,
    "maxConcurrency": 4,
    "maxOutputChars": 16000,
    "maxTools": 32
  }
}
```

Missing or invalid values fall back to the defaults. They never raise a limit above the hard maximum. While `enabled` is false, `piwin_codemode` is neither described nor callable. Existing direct tools and `piwin_toolbox` are unchanged.

## Callable surface

The script is an async function body. `await` and `return` work.

- `await tools.<name>(args)` for each compiled read-only Host tool in this generation, up to `maxTools`.
- `await tools.piwin_toolbox({ action, query, target, arguments, limit })` for `search`, `describe`, `call`, and `status`.

A Host tool is callable only when its registration says `readOnly: true`, its family and action are read-only, and it declares no file effect. Shell, browser, process, write, and unknown tools fail even if something marks the toolbox shell read-only. Guessing a name that was not admitted does not run it.

MCP tools are callable from a script only when the server's `tools/list` sets `annotations.readOnlyHint` to true. A missing hint is denied in scripts. Ordinary MCP calls outside a script stay config-trusted and do not open a new permission prompt. Script search and describe hide the same unhinted tools.

`piwin_codemode` cannot call itself.

## Results

If a tool result carries `scriptPayload.structuredContent`, the script receives that value. `scriptPayload.isError === true` rejects inside the script, as does any failed tool result. The script must not parse tool text to invent structure. Chat text and transcript details do not receive the nested payload. The model sees the bounded script output only.

`store` and `load` work only for the current invocation. Writes are discarded. They are not branch or resume state. Image and classifier helpers are not part of this slice.

## Limits and cancellation

The script stops at `timeoutMs`, the memory cap, the call budget, or the concurrency cap. Output past `maxOutputChars` is truncated. Aborting the host call aborts nested Host and MCP calls. A call still waiting for a concurrency slot does not start after that abort. The QuickJS worker is closed after success and after syntax or runtime errors. Completed nested reads are not rolled back.

SDK and RPC both call the same Host tool. The bundle keeps `@earendil-works/pi-codemode@1.1.0` external so its worker and WASM stay real files. Pi itself stays at 0.84.2.

## Reproduce backend acceptance tests

```sh
pnpm --filter @piwin/host-runtime exec vitest run src/codemode/codemode-backend.e2e.test.ts
```

Verified: 12 tests passed with a local scripted HTTP model (no credentials/setup required), real SDK sessions and spawned RPC JSONL workers, the Host execution port and QuickJS sandbox. Covers config-gated model visibility, >120k structured reads reduced to small output, generation/Run provenance, script/tool errors, and cancellation including a queued read. All fixture resources are disposed. Pi 0.84.2 reports mid-tool abort as a failed prompt (“This operation was aborted”); nested Host cancellation is still asserted promptly. See [acceptance evidence](../specs/codemode-readonly.md#dual-backend-acceptance-evidence-gap-001) for commands and scope; this is not a live-provider or packaged-worker test.
