# Evidence: live CPA/Grok 4.6 smoke

| Field | Value |
|---|---|
| Date | 2026-08-27 19:31–19:36 Asia/Shanghai |
| Branch | `codex/pi-native-turn-authority` |
| Pi | `@earendil-works/pi-coding-agent` 0.84.2 |
| Gateway | local CLIProxyAPI at `http://127.0.0.1:8317/v1` |
| Configured model | `custom-openai/grok-4.6` |
| Upstream model reported by CPA | `grok-4.6-build` |
| Scope | User-approved live smoke; no code or configuration changes |
| Secrets | Not recorded |

## Preflight

The authenticated `GET /v1/models` request returned HTTP 200 and included
`grok-4.6`. The unauthenticated request correctly returned HTTP 401.

## Results

### SDK: visible text stop

- CPA log: `v1-chat-completions-2026-08-27T193139-c6c62efc.log`
- Piwin CLI elapsed time: 6.51 s
- Response: HTTP 200, `finish_reason: stop`, `native_finish_reason: stop`,
  `[DONE]`
- CPA usage: prompt 1553, completion 41, reasoning 35
- Visible text: `LIVE_SMOKE_OK`
- Tools: none
- Result: **pass**

### RPC worker: visible text stop

- CPA log: `v1-chat-completions-2026-08-27T193246-f85b8b3e.log`
- Host measured prompt-to-terminal time: 2.45 s
- Response: HTTP 200, `finish_reason: stop`, `native_finish_reason: stop`,
  `[DONE]`
- CPA usage: prompt 1553, completion 44, reasoning 38
- Host events: message start/end, thinking delta, text delta/snapshot, usage
- Every foreground event carried the same `runId`
- Tools: none
- Result: **pass**

### SDK and RPC: requested empty visible answer

Two additional prompts asked the model to finish with no visible text.

- SDK CPA log: `v1-chat-completions-2026-08-27T193524-ad0218a5.log`
- RPC CPA log: `v1-chat-completions-2026-08-27T193555-20231e75.log`
- Both responses were HTTP 200 with `finish_reason: stop` and `[DONE]`.
- In both streams CPA emitted `delta.content: "<|eos|>"` after reasoning.
- Piwin consequently observed a non-empty text snapshot containing
  `<|eos|>` and terminalized the Run as completed.
- Result: **original thinking-only empty-text shape not reproduced**.

## Not reproduced live

Neither of the four new CPA streams ended without `finish_reason` or remained
open on `: keep-alive` after assistant progress. Therefore this smoke does not
claim a live missing-finish or parsed-stream-stall reproduction. Those paths
remain covered by the local fake-SSE evidence in
`docs/evidence/2026-08-27-pi-turn-authority-local-e2e.md`, which exercises the
same Pi SDK/RPC adapters and asserts native retry plus parsed-stream guard
settlement.

## Conclusion

The paid live path currently passes the normal visible-text stop through both
SDK and RPC worker modes. The model/gateway pair emits an EOS sentinel as
visible content when asked for an empty answer; this is distinct from a clean
Pi thinking-only stop and should be investigated as a CPA/xAI compatibility
behavior if it is user-visible in production. No evidence from this smoke
supports labeling the normal requests as network failures.

## Harness cleanup note

The direct RPC smoke process was interrupted after its terminal because
`HostRuntime.dispose()` did not return promptly while the just-finished prompt
was still settling. A control run that only created and disposed an RPC
session (no model request) returned from dispose in 10 ms. No worker process
was left behind. This is recorded as a separate cleanup/lifecycle observation,
not as a CPA model failure, and no production code was changed for it.
