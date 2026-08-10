# Immediate send feedback

Status: implemented

## Behavior

When a user sends a prompt, the UI keeps an active interaction surface visible
before the Host returns the run acknowledgment or the first assistant text:

- Desktop keeps `ChatThread` mounted during the optimistic streaming state so
  the existing run locator can render even with an empty transcript.
- Mobile and Side Chat show the shared `RadialBellow` animation with a
  connection status line until assistant text or a terminal event takes over.
- Existing stop, permission, error, and terminal handling remains authoritative
  for ending or replacing the waiting state.

## Verification

- `pnpm typecheck` in `apps/desktop`
- `pnpm typecheck` in `apps/mobile`
- Desktop `chat-thread.test.tsx` and `RunActivitySlot.test.tsx`
