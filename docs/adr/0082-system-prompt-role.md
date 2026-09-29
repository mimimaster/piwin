# ADR 0082: System prompt role on OpenAI-compatible providers

## Status

Accepted — 2026-09-29.

## Context

Issue #13: Qwen `qwen3.8-max` on DashScope
(`https://dashscope.aliyuncs.com/compatible-mode/v1`) returned
`400 developer is not one of ['system', 'assistant', 'user', 'tool', 'function']`.
The user had to run a local proxy that rewrote `role: "developer"` to
`role: "system"`.

Pi 0.84.2 sends the system prompt as `developer` for reasoning models unless
`compat.supportsDeveloperRole === false`. `developer` is the current OpenAI
convention and piwin keeps it as the default. The only problem is endpoints
that still reject it, and there was no way to opt them out.

## Decision

1. `developer` stays the default. Nothing is inferred from the base URL or
   model id beyond Pi's own detection.
2. `OpenAiCompatibleProviderConfig.systemPromptRole?` and
   `ModelConfigEntry.systemPromptRole?` take `developer | system`. A model
   value overrides the provider. Omitted means Pi's default.
3. `resolveSupportsDeveloperRole(provider, model)` in `@piwin/contracts`
   (`system-prompt-role.ts`) is the only implementation. It returns
   `undefined` when nothing was chosen or the setting does not apply: the
   model's effective wire is not OpenAI-compatible (ADR 0079 overrides
   included), or the provider is a subscription with a fixed wire.
4. Pi registration maps an explicit choice to `compat.supportsDeveloperRole`
   for both `openai-completions` and `openai-responses`. It is merged on top
   of the existing DeepSeek / Grok model-id compat, and the explicit setting
   wins.
5. The worker envelope carries the Host-resolved boolean per model
   (`supportsDeveloperRole`) only when set. The worker never reads config.
6. Settings: provider → Advanced → checkbox **系统提示使用 system 角色**, on
   OpenAI-compatible rows only, unchecked by default. Only `system` is saved.
7. Per model: the model editor has **系统提示角色** 跟随服务商 / developer /
   system, shown only when the model's effective wire is OpenAI-compatible.
   This covers one gateway routing model A to a `developer` upstream and
   model B to a `system` upstream. 跟随服务商 removes the model field.

## Consequences

- Existing configs send exactly what they sent before.
- Users on an endpoint that rejects `developer` tick one checkbox instead of
  running a rewriting proxy.
- No error-text matching or auto-retry with another role, because failures
  are classified structurally (`agent-failure.ts`), never from prose.
