# Grok composer Stop verification — 2026-10-01

## Failure and fix

Grok exposes cancellation but no pause checkpoint. The normal composer showed
Stop through capability gating, but `ComposerCardToolbar` supplied `onAbort`
only for embedded and stop-only layouts. Clicking the visible button therefore
invoked no Host command.

The toolbar now passes its required abort callback in every layout. A
`ComposerDock` regression renders a streaming backend without pause support,
clicks Stop through the real toolbar, and checks that only the abort callback
runs. Existing Pi Pause, embedded Stop and queued Send behavior stay covered by
the existing suites.

## Real Host evidence

- Test shell: `http://localhost:1420/`; Host: `ws://127.0.0.1:8787`.
- Test data root: `~/.piwin-test`; project: `auto-e2e-repo`.
- Backend version: Grok Build `1.0.46`.
- Session: `session-mup9pqm1-slm9iitw`.
- At 16:24 Asia/Shanghai, sent a long text-only response request and clicked
  the normal composer Stop button while output was streaming.
- The assistant message for Run `50404eb8-8d88-4cf0-84e4-743b19f91cc7`
  ended at `2026-10-01T08:24:30.434Z`. Its persisted metadata records
  `outcome: cancelled` and `agentStopReason: aborted`.
- The composer returned to Send. A new prompt in the same session returned
  exactly `STOP_RECOVERY_OK`; Run `2f97e9b7-1070-44dc-ae93-000bbde99879`
  ended at `2026-10-01T08:25:00.495Z` with `outcome: completed` and
  `agentStopReason: stop`.
- The shell initially had an obsolete saved endpoint on port 8788. Reconnecting
  it to the existing test Host on port 8787 restored the live connection.

The test used text prompts and made no project file changes. It verifies
Desktop-to-Host cancellation and subsequent prompt recovery on the observed
Grok build; it does not extend the earlier permission or installation probes.

## Automated verification

- `pnpm typecheck`: passed.
- `pnpm test:architecture`: passed.
- Desktop full suite: 715 files, 5,258 tests passed.
- Composer dock, action slot and assembly suites: 81 tests passed.
- Production file size: `composer-card-toolbar.tsx` is 292 lines.
