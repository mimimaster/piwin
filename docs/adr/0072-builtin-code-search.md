# ADR 0072: Built-in `code_search` (Devin Fast Context-aligned)

- Status: accepted
- Date: 2026-09-19
- Evidence: [docs/research/2026-09-19-devin-code-search-verified.md](../research/2026-09-19-devin-code-search-verified.md)
- Plan: [docs/plans/2026-09-19-builtin-code-search.md](../plans/2026-09-19-builtin-code-search.md)

## Context

Exploring an unfamiliar codebase with `grep`/`read` costs the main model its most
expensive resource: context and turns. Devin solves this with **Fast Context**: a
first-class tool whose registered name is `code_search`, which runs a short-lived
read-only search subagent (a fast model plus local `rg`/`readfile`/`tree`) and
returns file paths with line ranges.

piwin already reached the same capability through the `fast-context` MCP server,
but usage stayed low: an MCP tool looks like a foreign service (`mcp__…`
name, approval friction, an external key), while `grep`/`read` are always present
and always cheap to call. Capability was not the gap; product surface was.

Verified facts used here come only from Devin's own artefacts (its CLI binary and
recorded sessions): 458 calls, two parameters, the result framing, the subagent
prompt, and which prompt sections the binary does *not* contain.

## Decision

1. **`code_search` is a Host tool at the same level as `grep`/`read`/`bash`**, not
   an MCP server and not a subsystem. It is composed in
   `@piwin/host-runtime` and registered in the session tool set
   (`family: 'filesystem-read'`, read-only, `fileEffect: none`).

2. **The model-visible contract is Devin's, copied verbatim**: exactly two
   parameters (`search_term`, `search_folder_absolute_uri`), the tool description,
   the `<ANSWER><file><range>` subagent answer protocol, the
   `A / - Grepped … / It believes the snippets below …` result framing, and the
   truncation markers observed in recorded results.

3. **Reasoning backend is configurable** under `PiwinConfig.codeSearch`:

   - `backend: 'model'` (default) — an already-configured piwin model, via a new
     tool-calling completion path. No Devin/Windsurf account required.
   - `backend: 'windsurf'` — opt-in; the user supplies their own Windsurf/Devin
     token, stored in the keychain (`apiKeyRef`) or read from an env var.

   The two never fall back into each other: quota and privacy boundaries differ.

4. **Prefer-first guidance is injected when the tool is present**, mirroring
   `browser-system-prompt.ts`. A tool description alone loses to `grep`.

5. **Search root is bounded by the session workspace.** Devin accepts any absolute
   folder; piwin rejects roots outside the session workspace so this tool's read
   surface matches every other workspace tool.

6. **Local command execution is pure Node**, with ripgrep-equivalent semantics
   (regex, include/exclude globs, bounded output). No ripgrep binary dependency, so
   the tool works on every platform piwin targets.

## Consequences

- The MCP `fast-context` server is untouched and remains usable; this ADR does not
  remove it or migrate it.
- `windsurf` is the first piwin feature that speaks the Devin cloud protocol. Its
  transport follows the working reference client rather than the single-shot layout
  in `docs/specs/compactor-sdk.md` §9; both the divergence and the parts that are
  only fixture-verified are documented in
  `packages/host-runtime/src/code-search/backends/windsurf-protocol.ts`.
- Two prompt sections (`# NO RESULTS POLICY`, `# RESULT COUNT`) are fork wording
  that Devin's binary does not contain. Their *behavior* is corroborated by
  recorded 0-file results, so they are kept and labelled.
- `session-capability.ts` gained no new family: a dedicated `code-search` family
  would ripple through the capability resolver for no behavioral gain. Callers that
  need a separate toggle can add one later.
- Adding a settings section touches several registries
  (`section-registry`, `settings-shell`, `shell-navigation`,
  `settings-search-index`, `lazy-load`); that is the existing cost of a new
  section and is unchanged here.
