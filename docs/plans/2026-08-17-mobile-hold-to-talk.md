# Mobile status + hold-to-talk STT (2026-08-17)

Status: implementing (PR2)  
Related: ADR 0037, [iOS mobile shell execution plan](./ios-mobile-shell-execution-plan.md) §3.2 P1 语音输入, [2026-08-17 live bugfix](./2026-08-17-mobile-live-bugfix.md), [cockpit implementation](./2026-08-17-mobile-cockpit-implementation.md) (pairing + this feature as slice 5)

## 0. Verdict

`apps/mobile` is a working Host cockpit slice, not a finished product. Do **not** treat it as “no bugs, add features freely.”

Hold-to-talk speech-to-text is a good next *interaction* slice: it is already on the P1 list, the current mic is tap-toggle (wrong for this product), and Web Speech API is designed around press-start / release-stop. It is **not** a substitute for pairing, Keychain, chat errors, or camera.

Out of scope: Doubao-style live voice *call* (bidirectional audio). Piwin mobile remains a text agent cockpit; audio is client-side STT only. Host still receives text (+ image asset ids). Pi never gets raw audio.

## 1. Current health

### What already works

- Tauri 2 thin shell + `HostClient` WebSocket to a remote Host (not the Desktop sidecar).
- Connect / reconnect, session list/create/pin/rename/archive, streaming chat, thinking + live tool events, permission allow/deny, small image `media/save`, abort.
- 2026-08-17 live-test slice: `models/configured` picker, overlay hash, Web QR `invoke` guard, `NSCameraUsageDescription`, `session/list` `allScopes` + remote `projectId`.
- Host `session/messages` projection now includes `tools` (`packages/host-server` `projectRemoteTranscriptTools`); mobile `readSessionMessages` maps `tools` / `toolCalls`.

### Real remaining defects

| Severity | Issue | Why it matters |
|---|---|---|
| P0 | No real pairing / device credential; token lives in React state | LAN token is a demo. Product P0 in the iOS plan. |
| P0 | Chat canvas never renders `errorMessage` | Send/upload failures only show on the connection screen. |
| P0 | No `NSMicrophoneUsageDescription` / `NSSpeechRecognitionUsageDescription` | Current tap-mic will fail or crash on a real iOS WKWebView. Camera plist is present; speech plist is not. |
| P1 | File input is `accept="image/*"` only — no `capture`, no camera path | Photo-from-camera is a P0 cockpit capability. |
| P1 | Inbox is the current session’s run, not Host-wide active runs | Leaving chat hides work; that is the mobile job. |
| P1 | Artifact card / sheet exist but are unwired | Dead UI. |
| P1 | Current speech is tap-toggle; `setComposerText(transcript)` replaces the whole draft with the latest chunk | Does not accumulate finals; wipes typed text; no auto-send. |
| hygiene | Dead 5-tab surfaces (`MobileTabBar`, `SettingsSurface`, `MobileComposer`, …); theme options duplicated; `use-mobile-host.ts` is 972 lines | Hits the 1000-line cap on the next feature. Split before adding voice/send error/inbox. |

`use-speech-recognition.ts` also uses `any` for the SpeechRecognition constructor and events. Isolate behind a named type when rewriting for hold-to-talk.

## 2. What to add vs what must add

Mobile is a remote **agent cockpit**, not a second Doubao. Feature order:

### Must (product, before or beside voice)

1. **Chat-visible errors** — cheapest, already have the state.
2. **iOS speech + mic Info.plist** — required for any Speech API work.
3. **Pairing + Keychain** — without this, every other feature is a localhost toy.
4. **Camera capture** for the existing image attachment path.
5. **Cross-session Inbox** (active runs + pending permission) so the phone is useful away from the open chat.

### Good next (after the above, or in parallel if scoped tightly)

6. **Hold-to-talk STT → text → send** (this document). Highest mobile-native leverage.
7. Steer / follow-up while a run is live.
8. Sandboxed artifact preview (reuse `@piwin/artifact`, no Desktop chrome).
9. Reply TTS (read assistant text). Separate from STT; do not mix with mic (WebKit audio-session bug after `<audio>` / TTS).

### Do not add now

- Live voice conversation / “phone call” agent.
- Remote PTY.
- MCP / Skill / secrets editors on the phone.
- Copying Desktop IDE panels.
- Host-side Whisper as the first STT (extra Host surface; plan already says client STT or an *explicit* Host service).

## 3. Hold-to-talk research

### 3.1 What Doubao / DeepSeek actually do

Two different products get conflated:

| Product | Gesture | Result |
|---|---|---|
| **豆包 App composer** | Same control, two expressions: *tap* = keyboard, *long-press* = record. Placeholder “发消息或按住说话…”. Release auto-sends. | [UISDC 细节](https://www.uisdc.com/hunter/0221618640.html); HarmonyOS notes: 按住消息框转写。 |
| **豆包输入法** | Long-press **space** on the IME, optional 一键发送. Not the chat capsule. | Separate IME; we cannot and should not copy this. |
| **豆包语音通话** | Green phone icon, realtime duplex. | Out of scope. |
| **DeepSeek App** | Mostly **tap mic** (dictation into the box, then send). Some skins use long-press ~1s. WeChat-style “按住说话” appears in third-party shells (元宝), not as DeepSeek’s core composer. | Tap-mic is closer to our *current* code, not the requested UX. |

The user request matches **豆包 App composer**, not IME space-bar and not voice-call.

WeChat is the older pattern: explicit mode switch, then the whole bar is “按住 说话”, slide-up to cancel. Extra chrome; worse for a coding cockpit that still needs a keyboard most of the time.

### 3.2 Where to long-press (decision)

Do **not** long-press:

- The **send** button — it only exists when there is text; mixing send + voice is a known mis-tap.
- The live **textarea** itself — iOS long-press = select / callout / keyboard. Fighting the system loses.
- The whole screen / message list.

**v1 (recommended): long-press the empty-state mic button** (current 36×36 right control).

- Empty composer already shows mic, not send. That slot is the affordance.
- Keep tap on the **textarea** for keyboard (no conflict).
- Short tap on mic: haptic + toast “按住说话”, do **not** start a toggle session (today’s bug).
- Long-press threshold ~180–250ms, then start Speech API.
- `setPointerCapture` so release outside the 36px circle still ends the hold (Qwen web-shell hold-mode lesson).
- Hit target: visually 36px, expand the pointer area to ≥44px.

**v1.5 (Doubao-like, if v1 feels cramped):** when composer is empty and unfocused, a transparent hold layer covers the **capsule** (not the paperclip). Placeholder becomes “发消息或按住说话…”. First *tap* focuses the textarea and removes the layer; long-press starts STT. Once there is draft text, layer stays off and the right button is Send.

Do not ship WeChat “switch to voice bar” as default. Optional later toggle is enough.

### 3.3 Release → transcribe → send

Web Speech API `stop()` is the spec’s walkie-talkie primitive: stop listening and return a result from audio already captured. `abort()` discards. Canonical flow:

1. `pointerdown` (after threshold) → haptic → `recognition.start()`.
2. Overlay: “松开发送 · 上滑取消”. Live interim text in the overlay, **not** dumped into the textarea yet.
3. `pointerup` on the same pointerId → `recognition.stop()` → UI “正在识别…”.
4. Wait for `onend` **and** accumulated **final** transcripts (timeout ~1.2s). Then `handleSend` with that text.
5. `pointercancel` / slide-up past a Y threshold → `recognition.abort()`, no send.
6. Empty / `no-speech` / `nomatch` → no send, toast, composer unchanged.

Do **not** send in the `pointerup` handler. iOS often delivers the last final after `stop()`. Sending immediately races to empty text (`handleSend` already no-ops on empty).

If the composer already has typed text: v1 does not start hold (mic is hidden). If we later allow hold while drafting, **append** then send, never replace.

### 3.4 Speech API constraints (iOS WKWebView / Tauri)

- Need **both** `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in mobile `tauri.conf.json` `bundle.iOS.infoPlist`. Missing keys → `service-not-allowed` or launch crash. Camera-only plist is not enough.
- Push-to-talk is **more stable** on iOS than `continuous` + auto-restart (buffer clog, first-utterance miss, random `onend`). Keep a **singleton** recognizer; do not `new` on every press (system chime).
- Warm up once per session with `getUserMedia({ audio: true })` then stop tracks before the first `start()`.
- `continuous: true` + `interimResults: true` is OK *during a hold*. Do not auto-restart after `onend` unless the pointer is still down.
- `visibilitychange` → abort if backgrounded.
- Do not play TTS then immediately STT (WebKit audio-session bug; fix not on stable Safari as of 2026-08).
- Web preview (`pnpm --dir apps/mobile dev` in Safari) can demo the gesture; **real iOS Tauri** is the acceptance target. Android WK/Chromium support differs; gate on `SpeechRecognition \|\| webkitSpeechRecognition`.
- Fallback: if unsupported, hide hold-mic and keep keyboard. Do not fake listening.

Haptics: `navigator.vibrate` is weak/absent on iOS. Prefer a later Tauri haptic plugin; do not block v1 on it.

### 3.5 Coding-agent UX risk

Auto-send is correct for short spoken asks (“这个报错什么意思”). It is wrong for long coding prompts that need a glance at identifiers.

Mitigations in v1:

- Overlay shows the live transcript so the user can cancel before release.
- Slide-up cancel is mandatory.
- No send on empty/error.
- Later: settings “松手发送 / 松手填入输入框”. Default = send, matching the user’s request.

## 4. Implementation sketch (when building)

1. Split `use-mobile-host.ts` before adding more handlers (already 972 lines).
2. Extend `use-speech-recognition.ts` (or replace with `use-hold-to-talk.ts`): singleton, accumulate finals, `start` / `stop` / `abort`, `waitForFinal({ timeoutMs })`, named types, no `any`.
3. `ModernComposer`: pointer handlers on the empty-state mic; overlay; do not use `onClick` to toggle.
4. Pass `onSend` a text override or set composer then send only after finals.
5. Surface speech + send errors on the conversation canvas.
6. Info.plist mic + speech keys.
7. Tests: hold start/release, cancel, empty result, pointer capture outside button, tap-does-not-toggle (happy-dom). Real-device smoke on iPhone.

## 5. Acceptance (hold-to-talk)

- Empty composer: long-press mic → overlay + system mic indicator; speak; release → “正在识别…” → one `session/prompt` with the transcript; composer clears.
- Slide up or cancel → no prompt.
- Short tap mic → hint, no listening session left running.
- Textarea tap still focuses keyboard.
- Unsupported WebView: mic hidden, no crash.
- iOS permission dialogs appear once; denial is a clear in-app message.
