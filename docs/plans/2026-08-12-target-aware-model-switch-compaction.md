# Target-aware model switch compaction

## Goal

Prevent a session whose live context fits its current large-window model from
switching to a smaller-window model before the context has been compacted and
validated against the target model budget.

## Design

1. Keep model selection pending in Desktop when the current measured context
   exceeds the selected model's target input budget.
2. Send the target model identity to Host-owned compaction. Host resolves the
   configured context window and output reserve instead of trusting UI limits.
3. Compact the still-active source-model session, then validate the reported
   post-compaction occupancy against the target budget before Desktop commits
   the picker selection.
4. Repeat the same check in the detached `session/prompt` preparation path so
   CLI, older clients, attachments, and context added after selection cannot
   bypass the guard.
5. Preserve cold-session behavior: reconstructed runtimes inject a bounded
   product-history window, so they do not require mutating the dormant native
   context before a switch.

## Verification

- Unit-test shared budget calculation.
- Test target-aware manual compaction no-op, successful migration, and failed
  post-compaction validation.
- Test `session/prompt` compacts before applying the target model.
- Run touched package tests and repository typecheck.
