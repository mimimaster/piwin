# ADR 0019: Session auto-naming

## Status

Accepted and implemented (2026-07-29; corrected 2026-08-09)

## Context

Opaque `session-<id>` rows make project history unusable. Manual rename exists,
but it cannot be the normal path for every conversation. Automatic naming must
also respect two product boundaries:

1. session metadata belongs to the Host and must converge across every client;
2. model-facing instructions are not user-authored content and must never leak
   into the transcript, title, preview, search text, or export.

An August 2026 incident exposed the second boundary. Older Desktop builds
prefixed `[piwin-mode:*]` operating contracts into `PromptInput.text`. The text
fallback therefore produced titles such as `[piwin-mode:agent] [piwin-… - 4`.
The same session used a reasoning-capable model for the lightweight title call;
the former 50-token output budget could be consumed by `reasoning_content`,
leaving no title in `content`.

## Decision

Use a two-stage Host-owned pipeline: an immediate deterministic text title,
then a best-effort lightweight-model refinement.

### 1. Raw user text and model-facing prompt are separate values

Client shells send the human-authored body in `PromptInput.text` and structured
turn metadata such as `agentMode`. `@piwin/host-runtime` records and names from
that raw input first. Only then does Prompt Preparation clone the input and add
agent-mode contracts, orchestration guidance, recovered history, context refs,
plan state, media fallback text, and other model-only material.

Naming still calls `extractUserFacingBody` at its own boundary. This is required
for old transcripts and residual model-facing wrappers such as legacy Skill
prompts; it is defense in depth, not the primary separation mechanism.

### 2. Ordered naming pipeline

1. **Create without an explicit name**: write no placeholder title. The draft
   remains active but is not listed.
2. **First user prompt**: derive a bounded, human-readable title with
   `deriveDefaultNameFromMessage`, persist `nameSource: text`, and publish
   `session/name-updated` before model streaming begins.
3. **Completed exchange**: use bounded human text plus the latest assistant
   reply for a direct lightweight provider completion. A valid result upgrades
   `text` to `nameSource: llm`.
4. **Provider failure or unusable output**: keep the deterministic text title.
   A later completed exchange may retry while the source remains `text`.
5. **Manual rename**: persist `nameSource: user`; it is terminal and immutable
   to every automatic path.

The sidebar rule remains strict: unnamed/placeholder sessions are not listable.

### 3. Persisted source states

`SessionIndexRecord.nameSource` and `SessionSummary.nameSource` use:

| State | Meaning | Automatic overwrite |
|---|---|---|
| absent / `default` | unnamed legacy/default draft | text or LLM may fill |
| `text` | deterministic immediate fallback | LLM may upgrade |
| `llm` | accepted lightweight-model title | never |
| `user` | explicit user rename | never |

Historical `auto` values remain readable for list compatibility but are not
written by the current pipeline.

### 4. Lightweight provider call

The Pi SDK does not expose a standalone non-session completion. Host Runtime
therefore calls the configured OpenAI-compatible or Anthropic-compatible
provider directly for this narrow application service. It does not create or
mutate a Pi conversation.

The request:

- uses the session's most recent `ModelRef` and matching enabled provider;
- caps each user/assistant context contribution at 4,000 characters;
- allows up to 512 output tokens so reasoning-compatible models can emit final
  content, while the title output gate still enforces one concise line;
- has a 15-second abort timeout;
- never fails the Agent turn and emits a redacted Host warning on failure.

Unsupported protocols, unavailable credentials, HTTP/network errors, empty
content, and rejected output all leave the existing text title intact.

### 5. Legacy repair

List hydration and direct resume run a one-time, narrowly guarded repair for
pre-2026-08-08 records:

- only `nameSource: text` is eligible;
- the stored title must begin with a known internal prefix such as
  `[piwin-mode:*]`, `[piwin-prompt-meta ...]`, or `[piwin-skill:*]`;
- the replacement is derived from the first product-transcript user body;
- `user`, `llm`, clean text, missing transcript, and ambiguous titles are left
  untouched;
- the metadata write does not change `updatedAt` and publishes
  `session/name-updated` for attached clients.

This is a persisted-data migration seam, not a general quality heuristic.

### 6. Configuration and commands

`PiwinConfig.session.autoName` defaults to `true`. Setting it to `false` skips
the model refinement service; explicit rename remains available.

`session/rename` is the public manual override. The legacy
`session/auto-name` command remains a text-only compatibility command and is
not a second naming authority.

## Consequences

- Every normal conversation gets a usable title immediately without waiting
  for a provider request.
- Better titles are opportunistic; provider or model peculiarities cannot make
  a session disappear or break a turn.
- Host owns persistence and pushes, so Desktop, CLI, mobile, and future clients
  converge on one title.
- Old polluted records self-heal only when they are listed or resumed. The
  strict prefix/source guard favors preserving user data over aggressive
  cleanup.
- Direct provider completion remains an application-level integration that
  requires protocol-specific tests and redacted diagnostics.
