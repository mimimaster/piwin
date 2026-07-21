# WT-3 truncate strategy (W1 / CE-CHAT)

1. **Product transcript is the source of truth** (`~/.piwin/sessions/<id>/transcript.json`, ADR 0009).
2. **`session/truncate-from`** drops the target message id and everything after it in the product transcript only.
3. **No Pi JSONL rewind** in W1 — live Pi handle is discarded; next prompt uses a fresh product shell / live session.
4. **Next prompt rebuild**: host prefixes remaining product history via `buildProductHistoryContext` + `mergeProductHistoryIntoPrompt`.
5. **UI** reloads remaining messages from the truncate response so tail disappears immediately; edit/resend = truncate + prompt.
