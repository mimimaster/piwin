# ADR 0023: Model Questionnaire via Pi Extension UI

## Status

Accepted (2026-08-01) · Slice implemented

## Context

The model sometimes needs structured input from the user (pick a scope, choose
between options, supply a free-form value). Pi already exposes an Extension UI
bridge — `ctx.ui.select` / `ctx.ui.input` inside Extensions, surfaced by the
host as `extension/ui_request` → `extension/ui_resolve` over the existing
sidecar IPC. piwin had no model-facing tool that used it, so the only paths
were free-form chat text or a parallel product-owned question protocol.

A second question IPC would duplicate the Desktop dialog, force a new contract,
and diverge CLI/Desktop handling (AGENTS.md §5: no parallel logic).

## Decision

1. **Bundled Extension, not a new protocol.** The model-facing `questionnaire`
   tool is a bundled Pi Extension (`bundled-extensions/questionnaire.ts`,
   discovered via the ADR 0010 ResourceLoader path). It calls only Pi-native
   `ctx.ui.select` and `ctx.ui.input`; piwin adds no second question contract.
2. **Desktop renders an inline Composer prompt.** The shipped
   `extension-ui-prompt` component handles `extension/ui_request` for `confirm`
   / `select` / `input` without a modal. Choices are attached above the
   Composer input, while `input` requests (including questionnaire `Other`)
   reuse the main Composer textarea. Stop stays available alongside the
   question and continues through the existing abort command. No new IPC.
3. **CLI uses a Node-stdlib TTY handler on stderr.** `piwin chat` wires
   `createCliExtensionUiRequestHandler` into the existing
   `onExtensionUiRequest` seam on `createAgentHost`. Prompts render to
   `process.stderr` via `readline/promises`; **stdout stays clean** as the
   model/output protocol.
4. **Non-TTY cancels, never blocks.** When stdin/stderr is not a TTY (or
   `isInteractive` is explicitly false), the handler resolves the request as
   cancelled/unavailable instead of waiting for input that will never come.
5. **No new Pi dependency from apps.** `apps/cli` and `apps/desktop` consume
   only `@piwin/agent-host` public exports (`ExtensionUiRequest` /
   `ExtensionUiResponse` and the handler factory). No `@earendil-works/pi-*`
   import crosses the app boundary (AGENTS.md §1).

## Consequences

- SDK and RPC→SDK-fallback share one interaction path; Desktop and CLI share
  the same host bridge, differing only in the surface renderer.
- Desktop keeps the question attached to the Composer; no duplicate modal UI.
- CLI ships a simple numbered selector first. Arrow-key TUI and multi-select
  are future CLI-adapter enhancements, not new model contracts.
- Extensions may disable the bundled tool through the existing
  `config.extensions.disabledIds` (ADR 0010).
- Permission approval flow is unchanged and is not conflated with
  questionnaire answers (questionnaire is model↔user input, not a trust gate).

## Wiring invariant (2026-09-24)

The ADR 0030 backend refactor (6234b848) dropped the old
`onExtensionUiRequest` adapter option, and nothing passed the replacement
`CreateBackendSessionInput.extensionUi` port, so Pi bound no UI context and
`questionnaire` always returned `Questionnaire UI is unavailable`. The bridge
now lives at one seam:

- `ProductAgentHost` receives `requestExtensionUi` from `host-runtime-init`
  and hands every backend session a session-scoped `ExtensionUiPort`
  (SDK binds it in-process; RPC workers proxy it back to the parent).
- `piwin chat` (local and attached Host) answers `extension/ui_request`
  pushes with the TTY handler and resolves them via `extension/ui_resolve`;
  non-TTY still cancels instead of blocking.

## Alternatives considered

| Option | Why rejected |
|--------|--------------|
| New `ask-user` IPC + product question contract | duplicates Pi UI bridge; second Desktop dialog; CLI/Desktop divergence |
| Host-owned question tool (not an Extension) | bypasses Pi `ctx.ui`; reimplements UI routing; breaks "adapters over forks" |
| CLI renders prompts to stdout | pollutes the model/output protocol; breaks piping |
