# ADR 0045: Draft-scoped media upload and recoverable composer attachments

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 2026-08-11 |
| Related | ADR 0005, ADR 0036, ADR 0037, ADR 0041 |

## Context

Desktop currently creates an optimistic image preview, prepares the file in the
WebView, converts the complete payload to Base64, and sends it through the
ordinary `media/save` Host command. The compatibility command is scoped to a
durable `sessionId`; it must not require the Agent runtime to remain resident in
memory while the attachment is being saved.

This creates avoidable failure coupling:

- a paste depends on image decode, Base64 allocation, generic command transport,
  Host availability, session creation, media policy, and disk write;
- local and remote transports have different practical envelope limits;
- a transient Host restart is presented as if the image itself were invalid;
- a failed attachment disables the entire composer;
- the only visible action is an English `Retry` label drawn over the thumbnail,
  while the actual error is available only as a hover title.

The Host must remain the only writer under `~/.piwin/media`, and model-facing
images must continue to use native `ImageContent` rather than Base64 in prompt
text.

## Decision

### 1. Prepare attachments independently of sessions

Uploading an external attachment creates a Host-owned staged asset. It does not
create a session.

Staged files live under the existing media root:

```text
~/.piwin/media/.staging/<asset-id>/payload
~/.piwin/media/.staging/<asset-id>/metadata.json
```

The Host returns an opaque `assetId` and safe metadata. Clients do not construct
or depend on Host absolute paths. Staged metadata survives a Host restart.

When `session/prompt` is accepted, Host Runtime resolves every staged asset,
validates ownership and readiness, and atomically claims it into the target
session media directory before transcript persistence and model preparation.
Claim is idempotent for the same `assetId + sessionId + clientMessageId`.

### 2. Binary bytes do not travel in ordinary Host commands

Add a Host-issued, short-lived, single-use upload ticket:

```text
media/upload-ticket(metadata, draftId, clientAttachmentId)
  -> uploadUrl, ticket, assetId, limits

binary upload
  -> streamed bytes, progress, cancellation

media/upload-status(assetId)
  -> preparing | ready | failed
```

The local sidecar exposes the same upload endpoint on an ephemeral loopback
listener. A remote Host exposes it beside the authenticated Host Server. The
ticket is scoped to one client, one asset, the declared size/type, and a short
TTL. Gateway processes only forward transport and never inspect or store media.

The Host streams into a temporary file, enforces a byte limit while reading,
sniffs MIME, computes a digest, applies attachment policy, then atomically
renames the file. Partial uploads are deleted on abort, timeout, or validation
failure.

The existing Base64 `media/save` command remains temporarily for compatibility,
but new Desktop and Mobile code must prefer the upload capability. It is removed
after all first-party clients migrate.

### 3. Contracts expose asset identity and stable failure codes

Add public contracts in `@piwin/contracts` for:

- staged asset metadata and `assetId` references;
- upload ticket/status commands;
- upload limits and Host capability discovery;
- stable attachment failure codes and `retryable` classification.

The first failure taxonomy is:

```text
host-offline | timed-out | upload-interrupted | disk-unavailable
too-large | unsupported-type | decode-failed | unsafe-content
asset-expired | asset-not-found | internal
```

User-facing copy is owned by each shell's localization layer. Internal stack
traces and raw paths never become the primary user message.

### 4. A failed attachment does not silently disappear or lock text input

Composer attachment state is explicit:

```text
queued -> preparing -> uploading -> ready
                    \-> waiting-for-host -> uploading
                    \-> failed
any non-terminal state -> cancelled
```

Retryable transport failures may retry automatically with a small bounded
backoff. Policy failures such as `too-large`, `unsupported-type`, and
`unsafe-content` never loop automatically.

A failed attachment does not globally disable Send when text or other ready
attachments can be sent. Sending with failed attachments requires an explicit
choice: retry failed attachments, send without them, or return to the draft.
An attachment-only draft with no ready content changes its primary action to
Retry rather than displaying a disabled Send button.

Status and actions are rendered beside the thumbnail, never over its content.
All labels are localized and keyboard accessible.

### 5. Model compatibility is a separate send-time concern

Upload success means the Host safely owns the file; it does not claim that the
selected model can understand it. Vision capability, delegation, GIF
normalization, and text-only fallback are evaluated after assets are ready by
Host Runtime PromptPreparation, preserving ADR 0005 and ADR 0041.

## Consequences

Positive:

- paste/drop no longer creates empty sessions;
- images do not compete with command/push frames or generic JSON limits;
- local and remote clients use one attachment identity and recovery model;
- Host restarts and weak connections become recoverable states;
- text remains sendable when one attachment fails;
- errors become diagnosable without exposing secrets or Host paths.

Costs:

- the Host sidecar needs a loopback upload endpoint and staged-asset cleanup;
- contracts, Host Server, Host Runtime, Desktop, Mobile, transcript projection,
  fork/clone, and tests must migrate together;
- draft asset retention needs an explicit TTL and release lifecycle;
- the compatibility `media/save` path exists during migration and must have a
  removal deadline.

## Compatibility and migration

Interim Desktop behavior implemented on 2026-08-12 keeps the selected `File`
and blob preview inside the local New Agent draft, including while that draft is
parked in the sidebar. The compatibility `media/save` call is deferred until
Send creates the destination session. This removes session creation from paste
and makes image-only drafts recoverable while the upload-ticket/binary staging
transport below is still pending; it is not a substitute for that final
transport.

Phase 0 of the reliability plan
([2026-08-11 plan §7](../plans/2026-08-11-composer-image-attachment-reliability.md))
landed on 2026-08-13 and implements Decision 4 on the compatibility path:
failed chips no longer disable Send; the thumbnail stays uncovered with the
reason and retry/remove actions outside the chip; sending with failures asks
retry / send-without-them / go-back; an attachment-only draft turns the primary
action into Retry; strings are localized (zh/en). Failure classification is a
Desktop-side heuristic (`policy` / `connection` / `local`); the stable
`AttachmentFailureCode` contract remains Phase 1 work.

### Compatibility-path correction (2026-08-14)

`media/save` now validates that the target session exists in the durable
session index instead of requiring a resident Agent runtime. A session may be
cold after history browsing, Host restart, or residency eviction; the Host can
still persist the attachment, and the following `session/prompt` activates the
runtime as usual. This removes the `Unknown session` failure for valid cold
sessions without making attachment persistence allocate a Pi worker.

The staged upload decision below remains the long-term transport improvement:
it removes the Base64 command envelope and makes draft attachments independent
of a session id altogether.

### Compatibility-path correction (2026-08-22)

Composer attachments no longer stuff a whole screenshot into one `media/save`
JSON frame. Desktop uses `media/save-begin` / `media/save-chunk` /
`media/save-finish` so files up to `media.maxPasteBytes` (10 MiB) fit the 1 MiB
Host wire. One-shot `media/save` remains for small CLI/compat callers. Original
screenshot bytes are stored; GIF first-frame rasterization is unchanged.

### Compatibility-path correction (2026-08-31)

Sending a New Agent draft used to call `removeCurrentDraft()` before
`media/save`. That path disposed the draft snapshot, which deleted the
retained source `File` still required by the send flow. Immediate
paste-then-Send then surfaced `attachmentSourceMissing` ("附件已不可用") and
never issued `media/save`.

`removeCurrentDraft` now takes an explicit reason: `discard` (default) still
releases local Files and object URLs; `send` only drops the draft row/snapshot
and leaves send-held chips intact. Successful ACK, prompt-failure rollback,
and explicit discard/remove keep using the existing disposal path. No staging
protocol change.

### Compatibility-path correction (2026-09-02)

Session navigation can briefly hold one pending chip in both the live composer
and a parked session/draft snapshot. Attachment disposal is now holder-aware:
snapshot eviction releases a local `File` only after every holder is gone,
while a successful Send or explicit user removal purges duplicate holders
before releasing it. This prevents a visible chip from reaching Send with its
source already disposed; the staged upload protocol remains the long-term fix.

### Known debt on the compatibility path (recorded 2026-08-13)

- A `media/save` that succeeds and is then abandoned (chip removed, draft
  discarded, prompt never sent) leaves the file under `~/.piwin/media/` and may
  leave the just-created destination session empty. No reclaim/GC exists until
  the staged-asset TTL lifecycle below lands.
- Switching sessions while a send is in flight restores failure recovery state
  into whichever composer is active, so session A's text/chips can land in
  session B's composer. Recovery should bind to the originating session.
- When the deferred-save branch fails to create the destination session, the
  consumed draft sidebar row is not restored (composer content itself is kept).

1. Add new contracts and Host capability flags without changing current prompt
   attachment handling.
2. Implement staged assets and claiming while continuing to accept existing
   path-backed `MediaAttachmentRef` values from trusted local clients.
3. Migrate Desktop, then Mobile, to opaque asset references.
4. Project local absolute paths only inside Host-owned transcript/storage code;
   remote projections return asset metadata.
5. Remove Base64 upload from first-party clients, then deprecate `media/save`.

## Rejected alternatives

- **Keep Base64 and only raise size limits.** This increases memory use and
  leaves session, transport, timeout, and remote-limit coupling intact.
- **Let Tauri Rust write directly to `~/.piwin/media`.** This creates a second
  media authority outside Host Runtime and violates the Host-owned media rule.
- **Silently drop failed attachments and send text.** The user may believe the
  model saw an image it never received.
- **Disable Send for every attachment error.** This turns one recoverable item
  into a composer-wide dead end.
- **Create a session on paste.** Draft composition should not mutate durable
  session state before Send.
