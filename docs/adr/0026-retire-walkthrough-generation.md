# ADR 0026: Walkthrough generation — plan-completion always-on, custom prompt optional

## Status

Revised (2026-08-05) · supersedes the interim "full retirement" draft in the same number

## Context

Walkthrough had grown too many knobs:

- `autoGenerate` + every completed run with tools → noisy second model calls
- `concisePrompt` injection into every live prompt when auto was on
- `mode: custom` with a **separate model picker** + custom prompt
- Desktop **Generate** button + regenerate

Users wanted:

1. Editable **generation prompt** for walkthrough content
2. **No** separate model selection (use the session/message model)
3. **No** every-turn auto generation
4. **No** manual generate button on Desktop
5. No "extra agent thread + stitch into chat bubble" design
6. Walkthrough **always generated** when a plan completes (not optional)

## Decision

### Product surface

| Capability | Decision |
|------------|----------|
| Generation prompt (`walkthrough.custom.prompt`) | **Keep** — used when `enabled` is true |
| Default prompt (`DEFAULT_WALKTHROUGH_PROMPT`) | **Keep** — used when `enabled` is false |
| Separate walkthrough model (`custom.model` / custom mode) | **Remove** — always resolve message → session → config default model |
| `autoGenerate` after ordinary runs | **Remove** — always normalized `false` |
| Concise-prompt injection on live turns | **Remove** |
| Desktop Generate / Regenerate buttons | **Remove** — existing cards remain viewable |
| Plan-completion generation | **Always on** — not gated by any config flag |
| `walkthrough/generate` IPC | **Keep** for CLI/host paths; no longer gated by `enabled` |
| `walkthrough/list` + store | **Keep** |
| `enabled` config field | **Repurposed** — controls whether custom prompt is used (not whether generation happens) |

### Config shape (compat)

Keep the existing `WalkthroughConfig` object so old config files load, but normalize to:

- `enabled`: user-controlled (default `false` = use default prompt)
- `autoGenerate`: always `false`
- `mode`: always `default`
- `custom.model`: always `null`
- `custom.prompt`: preserved user prompt (default `DEFAULT_WALKTHROUGH_PROMPT`)

### Runtime

```text
trigger (plan complete or walkthrough/generate IPC)
  → model = session/message/config default (never custom.model)
  → prompt = enabled ? walkthrough.custom.prompt : DEFAULT_WALKTHROUGH_PROMPT
  → completeWalkthrough (Host-side completion, not chat stitch)
  → plan/updated-style push walkthrough/updated
  → WalkthroughCard (view only)
```

Plan completion always triggers generation. Ordinary chat turns never do.
The `enabled` flag only controls which prompt is used, not whether generation happens.

## Consequences

- Settings page: custom-prompt switch + prompt editor.
- Ordinary chat turns do not spawn walkthroughs.
- Plan execution completion always generates a walkthrough.
- CLI `walkthrough generate` still works (uses session model + configured or default prompt).

## Alternatives considered

1. Full retirement of generation — rejected; prompt customization is still wanted.
2. Custom model + prompt — rejected; dual-model complexity without enough value.
3. Stitch walkthrough into the assistant bubble — rejected; transcript/timing complexity.
4. Gate plan-completion generation behind `enabled` — rejected; Walkthrough is a standard
   delivery document for plan mode, not an optional feature. The switch should control
   prompt customization, not whether the document exists.

## References

- `packages/contracts/src/walkthrough.ts`
- `packages/agent-host/src/commands/walkthrough-commands.ts`
- `packages/agent-host/src/commands/plan-commands.ts` (`triggerPlanCompletionWalkthrough`)
- `packages/agent-host/src/walkthrough-source.ts` (`assembleUserPrompt`)
- `apps/desktop/src/settings/pages/session-page.tsx`
- `apps/desktop/src/walkthrough-action.tsx`
