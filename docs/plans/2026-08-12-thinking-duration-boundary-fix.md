# Thinking duration boundary fix

Status: implemented

## Problem

Desktop displayed the whole active Run duration as “thinking” duration. After reasoning had already moved into answer or tool work, the label could therefore keep climbing indefinitely (for example, “已思考 1707 秒”).

## Boundary

- Start timing on the first non-empty `message/thinking_delta`.
- Stop timing on the first answer text, tool start, message end, abort, or error.
- Preserve the first start and end values; later events must not extend the interval.
- Persist the interval with the transcript so session hydrate keeps the same fixed duration.
- Legacy rows without reasoning boundaries show “思考过程” without a fabricated duration; they must never use the whole Run interval or `Date.now()` after thinking is inactive.

## Implementation

- Added optional reasoning start/end timestamps to the transcript contract and SQLite metadata.
- Recorded boundaries in both the production store recorder and legacy JSON recorder.
- Hydrated persisted timestamps into Desktop message state.
- Split “Run active” from “reasoning active” in turn presentation.
- Render active animation only during actual reasoning and show ordinary working state during tool/answer work.

## Verification

- Desktop reducer, presentation, and rendered-thread regression tests.
- Session transcript metadata round-trip test.
- Host transcript recorder boundary test.
- Workspace TypeScript typecheck.
