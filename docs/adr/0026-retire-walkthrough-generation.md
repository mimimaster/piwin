# ADR 0026: Simplify Walkthrough generation (prompt only, session model)

## Status

Accepted (2026-08-03) · supersedes the interim "full retirement" draft in the same number

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
4. **No** manual generate button
5. No "extra agent thread + stitch into chat bubble" design

## Decision

### Product surface

| Capability | Decision |
|------------|----------|
| Generation prompt (`walkthrough.custom.prompt`) | **Keep** — always used when generating |
| Separate walkthrough model (`custom.model` / custom mode) | **Remove** — always resolve message → session → config default model |
| `autoGenerate` after ordinary runs | **Remove** — always normalized `false` |
| Concise-prompt injection on live turns | **Remove** |
| Desktop Generate / Regenerate buttons | **Remove** — existing cards remain viewable |
| Plan-completion generation | **Keep** when `enabled` |
| `walkthrough/generate` IPC | **Keep** for plan/host/CLI paths; fails when `enabled: false` |
| `walkthrough/list` + store | **Keep** |

### Config shape (compat)

Keep the existing `WalkthroughConfig` object so old config files load, but normalize to:

- `enabled`: user-controlled (default `true`)
- `autoGenerate`: always `false`
- `mode`: always `default`
- `custom.model`: always `null`
- `custom.prompt`: preserved user prompt (default `DEFAULT_WALKTHROUGH_PROMPT`)

### Runtime

```text
trigger (plan complete or walkthrough/generate IPC)
  → if !enabled: stop
  → model = session/message/config default (never custom.model)
  → prompt = walkthrough.custom.prompt
  → completeWalkthrough (Host-side completion, not chat stitch)
  → plan/updated-style push walkthrough/updated
  → WalkthroughCard (view only)
```

This is still a **second completion** after the agent turn (or after plan execution), but:

- same model family as the session (no dual-model picker)
- not a subagent session
- not spliced into `assistant.text`

## Consequences

- Settings page: enable switch + prompt editor only.
- Ordinary chat turns do not spawn walkthroughs.
- Plan execution completion may still generate one when enabled.
- CLI `walkthrough generate` still works when enabled (uses session model + configured prompt).

## Alternatives considered

1. Full retirement of generation — rejected; prompt customization is still wanted.
2. Custom model + prompt — rejected; dual-model complexity without enough value.
3. Stitch walkthrough into the assistant bubble — rejected; transcript/timing complexity.

## References

- `packages/contracts/src/walkthrough.ts`
- `packages/agent-host/src/commands/walkthrough-commands.ts`
- `packages/agent-host/src/walkthrough-source.ts` (`assembleUserPrompt`)
- `apps/desktop/src/settings/pages/session-page.tsx`
- `apps/desktop/src/walkthrough-action.tsx`
