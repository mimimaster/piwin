# ADR 0028: Provider priority for default-model selection

## Status

Accepted (2026-08-03)

## Context

Users can configure multiple providers that expose the **same model id** (e.g.
two OpenAI-compatible gateways both serving `deepseek-v4-flash`, or an
OpenAI-compatible proxy fronting Gemini alongside the native Gemini endpoint).
piwin resolves the default chat model with `resolveDefaultModelRef`
(`packages/host-runtime/src/provider-helpers.ts`):

1. configured `defaultProviderId` + `defaultModelId` if `resolveChatModel` succeeds
   (channel or v1 subscription account),
2. first **logged-in** v1 account in `V1_SUBSCRIPTION_PROVIDER_IDS` order
   (`kimi-coding`, `openai-codex`, `anthropic`, `xai`, `github-copilot`)
   plus that provider’s first Pi chat catalog model,
3. **highest-priority enabled channel** (its first chat model).

The fallback silently depends on config file ordering, which users cannot see
or control from the UI. There is no way to say "prefer gateway A, then B, then
native" for the same model name.

Evaluation of alternatives (2026-08-03):

- **Gateway products (LiteLLM proxy, OpenRouter)** already provide full
  load-balancing/failover for identical models. piwin can already consume them
  as an `openai-compatible` provider (ADR 0004). Building a native
  load-balancer/failover chain in the host would duplicate that and add weight.
- A **failover chain** (retry same model on provider B when provider A errors)
  is real reliability work (error classification, cooldowns, streaming
  mid-flight semantics) — not needed yet, and `SessionTurnProfileError` already
  surfaces `model-unavailable` to the UI.

## Decision

Add an optional per-provider `priority: number` field (lower wins) that only
influences **default-model fallback** ordering.

- `ModelProviderConfig` gains `priority?: number` (shared
  `ProviderConnectionConfig` in `@piwin/contracts`).
- `sortProvidersByPriority` (contracts) sorts enabled providers ascending by
  priority, preserving config order for equal / absent priorities. Absent
  priority sorts after all explicit values.
- `resolveDefaultModelRef` fallback uses the highest-priority enabled provider
  instead of the first in array order.
- Desktop `resolveDefaultAfterProviderChange` uses the same sort so the UI's
  "default" marker matches what the host would actually pick.
- Validation: `priority` must be a non-negative integer.
- Desktop provider drawer exposes the field under **Advanced**.

### Explicit non-goals (this ADR)

- No auto-failover / load balancing on the same model id. If a provider is
  unreachable the turn fails with the existing `model-unavailable` /
  network-error surface; no silent switch to another provider.
- No per-model priority. Priority is provider-scoped; all models of a provider
  inherit its ordering.
- No runtime re-routing of an already-started session.

## Consequences

- Users can express "prefer this provider for the default model" without
  reordering the config file.
- Backward compatible: existing configs (no `priority`) sort in config order,
  exactly the previous behavior.
- Provider-scope only: the composer model picker still shows every
  `providerId::modelId` option explicitly; priority never hides or merges them.

## Alternatives considered

1. **Native failover chain (ModelRef fallbacks)** — Rejected for now: real
   reliability subsystem (cooldowns, error taxonomy, mid-stream retry) with no
   product signal yet; gateways cover it for users who need it.
2. **Reordering providers in the settings UI** — Rejected: implicit ordering is
   fragile (discovery/preset additions append at the end), and priority is
   explicit and survives future sorts.
3. **Gateway-first documentation only** — Rejected as insufficient: a tiny
   explicit field answers the same-model question at the config layer.

## References

- `packages/contracts/src/config.ts` (`ProviderConnectionConfig`,
  `sortProvidersByPriority`)
- `packages/agent-host/src/provider-helpers.ts` (`resolveDefaultModelRef`)
- `packages/agent-host/src/provider-validation.ts`
- `apps/desktop/src/provider-draft.ts` (`resolveDefaultAfterProviderChange`)
- `apps/desktop/src/provider-drawer.tsx` (Advanced → Priority)
- ADR 0004 (user-configured dual protocol surface)
