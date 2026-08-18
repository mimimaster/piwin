# Desktop remote Host attach — visual QA for Codex

Date: 2026-08-17

Use this as a self-contained Codex prompt. Goal: verify Desktop still works as the daily sidecar product, and that Settings → General can attach to a standalone `apps/host` without silently replacing a busy run.

## Repo

`/Users/yorickjue/Developer/piwin`

Do **not** git-merge `feat/standalone-host-multi-client-continuity`. Pairing / APNs / iOS are out of scope.

## What landed (code)

- Desktop can save a remote target (`ws://` / `wss://`) in Settings → General → 远程 Host.
- Composer chip: Local (本机 / This Mac) vs Remote Host. Local stays available to switch back (clears the saved target and rebuilds the JSONL sidecar client).
- Remote `session/prompt` always sends `foreground: { kind: 'if-idle' }` first. Busy Host returns structured `foreground-run-mismatch`. UI shows a confirm dialog 「中断并发送」 / Interrupt and send, then retries with `replace-run`.
- Omitting `foreground` on the remote wire is rejected by Host Server. Local sidecar may still omit it.
- Remote session list uses `scopeRef` / opaque `projectId`, never Host filesystem paths.

## Prep

Terminal A — standalone Host (stop Desktop first so they do not fight over `~/.piwin`):

```bash
cd /Users/yorickjue/Developer/piwin
pnpm --filter @piwin/host exec node --import tsx ../../apps/host/src/index.ts
# or the repo’s documented apps/host start; default ws://127.0.0.1:8787
```

If Host requires `PIWIN_HOST_TOKEN` for non-loopback, keep Desktop on `ws://127.0.0.1:8787` (loopback). Copy any token the Host printed.

Terminal B — Desktop:

```bash
pnpm --filter @piwin/desktop dev:tauri
```

## Visual checks

1. **Sidecar still works (regression)**
   - Launch Desktop with no remote target saved (or click 使用本机).
   - Chip trigger shows 本机 / This Mac.
   - Send a short chat in General. Streaming, stop, Knowledge Center, composer all still work.
   - Screenshot: composer chip + a successful local reply.

2. **Settings Host target**
   - Settings → General → 基础设置.
   - Section 「远程 Host」 is visible under language.
   - Invalid URL (e.g. `http://x`) shows the invalid-endpoint notice.
   - Connect `ws://127.0.0.1:8787` (+ token if needed). Success notice includes `hostInstanceId`.
   - Screenshot: settings card after connect.

3. **Chip switches to Remote Host**
   - After a successful connect, composer chip label becomes 远程 Host / Remote Host.
   - Open the menu: Local is enabled and selectable; Remote Host is the active (●) item.
   - Screenshot: open runtime menu while remote.

4. **Remote if-idle vs replace-run**
   - On the remote Host, start a long run from this Desktop (or leave one running).
   - Send another prompt from the same session.
   - Expect a confirm dialog: 「会话正在处理」 / Session is busy, confirm 「中断并发送」.
   - Cancel: original run continues; no silent supersede.
   - Confirm: new prompt is acked; old run terminals with superseded-by-new-prompt (not a crash).
   - Screenshot: confirm dialog; then transcript after interrupt.

5. **Switch back to This Mac**
   - Chip → 本机, or Settings → 使用本机.
   - Chip returns to Local. Sidecar chat works again.
   - Screenshot: local chip after switch-back.

6. **Do not regress memory diet / catalog**
   - Local sidecar: Knowledge Center opens; a tool call still presents as the current catalog (`piwin_toolbox`), not a second `mcp_gateway` ritual.
   - No need to re-measure WebContent GB unless something looks newly bloated.

## Fail if

- Remote send without a dialog silently kills the other run.
- Chip still says 云端 / Cloud, or Cloud is permanently disabled after a successful connect.
- Settings connect writes a filesystem path into session list rows (project paths from the Host).
- Connecting remote takes down the local-only happy path after 使用本机.

## Report

Return: pass/fail per check, screenshots or a short note when a screenshot is impossible, Host log lines for the replace-run case, and any console errors from the Desktop WebView.
