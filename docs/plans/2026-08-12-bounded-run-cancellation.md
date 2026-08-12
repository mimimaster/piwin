# Bounded foreground Run cancellation

## Problem

A provider can emit an error and leave its Pi prompt or abort promise pending.
Desktop correctly changes the foreground Run to `cancelling`, but Host currently
waits without a deadline for the live-session abort and process cleanup before
publishing the terminal Run. The Stop control therefore remains disabled and
the activity locator keeps rotating indefinitely.

## Design

1. Keep `session/abort` as a quick control-lane acknowledgement.
2. Give the background cancellation join a short Host-owned deadline.
3. When cleanup acknowledges in time, preserve the existing exact
   `cancelled` terminal path.
4. When cleanup misses the deadline, publish a `cancelled` terminal with a
   diagnostic message, detach the stuck generation from Host authority, reject
   its late events and Host-tool calls, and allow the next prompt to activate a
   fresh generation.
   The timeout terminal skips a second synchronous Job cleanup join because the
   original session cleanup is already running in the background.
5. Release the quarantined backend generation asynchronously and by exact
   `(sessionId, runtimeGenerationId)` identity so delayed cleanup cannot remove
   a newer generation.

## Provider settings review

The concurrent provider fix correctly treats the API-key input as a raw secret
and writes it to the keychain instead of guessing that all-uppercase or numeric
values are environment-variable names. Preserve an explicit advanced
environment-variable field for RPC mode, because worker JSONL must not carry a
resolved keychain secret. SDK prefers `apiKeyRef`; RPC uses `apiKeyEnv` when it
is explicitly configured.

## Verification

- Provider draft and compiler tests cover raw numeric keys and SDK/RPC secret
  source selection.
- Session live-command tests cover an abort promise that never settles and
  assert one bounded terminal plus runtime quarantine.
- Run focused Desktop, Host Runtime, and Agent Host tests, then repository
  typecheck.
