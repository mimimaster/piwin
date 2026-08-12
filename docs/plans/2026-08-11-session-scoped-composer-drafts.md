# Session-scoped composer drafts

## Problem

Desktop currently routes unsent text from an existing Host session through the
local “New Agent” draft-row path when the user changes sessions. The text then
appears as a phantom sidebar conversation, while returning to the original
session shows an empty composer.

The history-resume path also shows a read-only-shell notification even though a
subsequent send transparently reopens the live agent. That implementation detail
does not help the user complete the task.

## Intended behavior

- New Agent text remains a local draft row until first send.
- Image-only and text-plus-image New Agent drafts retain their attachment chips
  and local previews when parked and resumed.
- Starting another New Agent parks the current unsent text as a local draft row
  before opening an empty composer.
- Project-folder New Agent actions capture the clicked project scope explicitly;
  they never depend on an asynchronous project-open render completing first.
- Text, attachments, and structured context entered in an existing session are
  stored under that session id when the user leaves it.
- Returning to an existing session restores only that session's composer state.
- Switching between existing sessions never creates a local draft row.
- Sending or explicitly clearing the composer removes the session snapshot on
  the next transition.
- Resuming history is silent; the transcript itself is sufficient feedback.

## Implementation

Keep three intentionally separate stores inside the Desktop composer hook:

1. `DraftSessionItemUi[]` for Host-less New Agent drafts shown in the sidebar.
2. A draft-id keyed snapshot store for each New Agent draft's text, attachment
   chips/local previews, and structured context references.
3. A session-id keyed in-memory composer snapshot store for existing sessions.

Session snapshots retain the exact text plus pending attachments and structured
context references. Switching hides resources without cancelling or revoking
them; restoration reconciles any media upload that completed while its session
was inactive.

## Verification

- Existing session A → session B → A restores A text and attachments.
- Independent text in A and B stays isolated.
- Existing-session switches create no phantom draft rows.
- New Agent text still becomes a local draft row when leaving it unsent.
- New Agent A → New Agent B keeps A as a clickable draft row and starts B empty.
- Project draft rows remain under their project instead of leaking into General
  Conversations.
- Image-only draft → existing session → image draft restores the attachment and
  does not create a Host session until Send.
- The history-restored notification string is absent.
