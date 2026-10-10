# ADR 0085: iOS Live Activity and native audio

Status: Accepted, 2026-10-07. Owner request: implement Live voice on Dynamic Island and accept using an iOS simulator.

## Decision

The iOS shell publishes one ActivityKit activity for its locally owned Live call on iOS 17 or later. A WidgetKit extension renders compact/minimal/expanded Dynamic Island presentations and a lock-screen card. The expanded Island includes the current bound session; the lock-screen card omits the title. The system controls when and where it presents the activity, including iPhones without Dynamic Island.

`LiveSystemActivity` and `LiveSystemControl` are the public presentation contract. They contain call identifiers, safe state and timing, never credentials, audio, transcripts or tool payloads. Call IDs guard every control against stale cards. Mute and end App Intents wake the app, then use the existing owner controller and Host commands. Native end immediately stops audio before waiting for Host acknowledgement. Failed Host mute rolls local mute back. App launch removes orphan cards; media failure and end dismiss the current card.

Grok/OpenAI Realtime PCM uses an iOS native AVAudioEngine and ephemeral URLSession WebSocket through `tauri-plugin-piwin-live`. The existing `@piwin/voice/wire` adapter supplies session setup, framing and event normalization; native code transports PCM and forwards permitted non-audio events. Raw audio stays in memory. Capture backpressure and queued control events are bounded and fail closed. The native card can update speech activity while WebKit is suspended. Interrupted audio ends media rather than showing a healthy silent call.

`UIBackgroundModes=audio` is permitted exclusively for a user-started native Live audio session. It grants neither a general Host WebSocket keepalive nor notification delivery. ADR 0064's notification restrictions remain in force. Codex WebRTC and Gemini's existing browser media paths do not gain durable background media from this change. Background Host task admission, permission responses and task feedback may wait until the shell resumes; native code never creates Runs or approves tools.

Live Activities need user/system authorization and can be dismissed by the system. Disabling them does not block Live voice. Force termination cannot preserve audio. Bluetooth, locked-device recording, interruptions and long background sessions require physical-device validation; a simulator card preview is not evidence of microphone or upstream conversation success.

Live startup bounds microphone permission waits to 30 seconds and displays
them separately from media negotiation. Cancellation releases late browser
streams and cancels native preparation. The iOS plugin allows the event
listener registration/removal commands used by Tauri's `addPluginListener`;
these are internal IPC capabilities, separate from system microphone consent.
Host start uses a 30-second budget, with 5 seconds for status/end controls.

## Verification

The native shell minimum is iOS 15, consistently set in Tauri and the Xcode
template, matching the existing Swift plugin minimum. Earlier minimums linked
an embedded backdeployment concurrency runtime alongside the simulator system
runtime. ActivityKit orphan cleanup then crashed in `TaskAllocator`.
`pnpm verify:mobile-ios-runtime` checks the resulting Mach-O link path,
minimum version and absence of the obsolete bundled library. Build success
and a visible system card alone are insufficient evidence of stability.

The simulator-only card fixture is reached only through a debug Rust URL branch, is unavailable on physical devices, uses no credentials or media and cannot create Host work. It exercises the shipped manager, widget and intents. Unit tests cover safe projection, stale controls, native connection isolation, delayed microphone approval, accepted PCM negotiation, delegation forwarding and mute rejection. Native build and simulator observations are recorded in the implementation plan.

References: [ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [Widget interactivity](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities), [AVAudioSession playAndRecord](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord).
