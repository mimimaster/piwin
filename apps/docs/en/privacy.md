---
title: Privacy Policy — piwin shell
description: Privacy policy for piwin shell (iOS / iPadOS) — what data the app accesses, where it goes, storage and retention, third parties, children, your rights and how to contact us.
outline: [2, 2]
lastUpdated: false
---

# piwin shell Privacy Policy

[中文](/privacy) · **English**

- **Effective date:** October 8, 2026
- **Operator:** Shanghai Hailebei Trading Co., Ltd. (Apple Developer Team ID F47G63A8DM; "we", "us")
- **Contact:** [github.com/mimimaster/piwin/issues](https://github.com/mimimaster/piwin/issues)

## 1. Scope

This policy applies to the iOS / iPadOS app **piwin shell** (bundle ID `app.piwin.mobile`, "the app").

The app is a remote client for the Piwin desktop app (the "Host"). The Host is software you install on, and control from, your own computer. The app itself does not run code or access files on your computer; every task is executed by the Host you pair with.

## 2. Summary

- The app has **no sign-up or account system**.
- We **operate no server that receives, stores or analyzes your data**, and we cannot see anything you do in the app.
- The app contains **no advertising, analytics or crash-reporting SDKs**, does not track you (it does not use the advertising identifier, IDFA), and does not sell or rent your data.
- Data handled by the app goes to only three places: **your device**, **the Host you pair with**, and **the AI model / voice providers you configure on that Host**.

## 3. What the app accesses, why, and where it goes

| Data | Purpose | Where it goes |
|---|---|---|
| Messages you type; photos you take or pick from your library | Chatting with the agent | Sent to your paired Host; the Host passes conversation content to the AI model provider you configured, according to your settings |
| Dictation (hold to talk) | Turning speech into text | Transcribed by iOS speech recognition (on device or by Apple, depending on system settings, under Apple's privacy policy); the resulting text is sent to your Host |
| Live voice audio (optional, only when you start a Live call) | Real-time voice conversation | Streamed directly from your device to the voice-model provider you configured on your Host (such as OpenAI, xAI or Google) using short-lived credentials issued by your Host; audio is processed in memory and the app does not save recordings |
| Camera | Scanning the Host pairing QR code; taking photos to attach | QR codes are decoded on device; photos are sent to your Host only when you choose to send them |
| Host address and access token | Connecting to your Host | Stored in the iOS Keychain on your device and used only to connect to your Host |
| Local network | Connecting to a Host on your LAN | Used only to communicate with your Host |
| Session list cache, drafts and app settings | Offline viewing, keeping unsent input | Stored only on your device |
| Browser mirror | Viewing a browser session running on your Host | Pages are loaded by your Host and the picture is relayed to the app through it; websites you visit handle data under their own policies |
| Apple Health data (optional) | Answering your health questions, producing the health summaries you enable | See section 4 |

## 4. Apple Health (HealthKit) data

- **Read-only.** The app only reads Apple Health data and **never writes to or modifies** Apple Health.
- **Only with your permission.** The app reads health data only after you grant read access in iOS and turn the health feature on in the app, and you can allow just some categories. Categories it may read: steps, active energy, exercise minutes, time in daylight, resting heart rate, heart rate variability, body mass, body fat percentage, VO2 max, respiratory rate, blood oxygen, wrist temperature, workouts, sleep (duration, stages, schedule) and mindful minutes. The app reads and sends **summaries** of these categories (for example daily totals or averages).
- **In chat.** When the agent needs health data to answer your question, the app by default **asks for your consent every time** and shows where the data will be sent (a local model or an external model provider). You can allow or deny, or change the setting to "Always allow this Host" or turn the feature off.
- **Background sync (optional).** If you turn on background sync of health summaries, the iPhone uses HealthKit background delivery to upload daily health summaries to your paired Host, where they are stored, so health questions work while the phone is offline and the scheduled summaries you enable can be produced.
- **Where it goes.** Health summaries are sent only to your paired Host. Only when you use the health feature in chat, or have scheduled health summaries turned on, does the Host pass the relevant summaries to **the AI model provider you configured** for analysis, according to your settings. If you use a local model on your Host, this data does not leave your own device and computer.
- **Our commitment.** HealthKit data is **never used for advertising, marketing or use-based data mining, never sold, and never shared with any third party** — except that it is sent, as you direct, to the AI model provider you configured. We ourselves never receive or store any of your health data.
- **Retention and deletion.** Summaries uploaded to the Host by background sync are stored on your Host for the retention period you set there (30, 90, 180 or 365 days). Turning off background sync also deletes the summaries this device uploaded. Summaries that appear in a chat are kept with that session on your Host until you delete them.

## 5. Storage and retention

- **Your device:** connection credentials are stored in the iOS Keychain; session caches, drafts and settings are stored on your device. You can disconnect a paired Host in the app, and deleting the app removes its local caches.
- **Your Host:** conversations, attachments and health summaries are stored on your own Host (your computer), where you manage and delete them; we have no access.
- **Third-party providers:** content you send to the AI model / voice providers you configure is retained under their own policies.
- **Us:** we keep none of your data.

## 6. Third-party services

- **AI model and voice providers you configure** (for example OpenAI, Anthropic, xAI or Google): you choose them and use them with your own account or keys, and they process what you send under their own privacy policies. We have no data-sharing or business relationship with them; please read the privacy policy of each provider you use.
- **Apple:** iOS system services such as speech recognition, HealthKit and the Keychain operate under Apple's privacy policy.
- The app includes no advertising, analytics or crash-reporting SDKs.

## 7. Children

The app is intended for developers and is not directed at children under 13 (or the equivalent minimum age in your jurisdiction). We do not knowingly collect personal information from children.

## 8. Your rights and choices

- You can turn off camera, microphone, speech recognition and local network access in iOS Settings at any time, and revoke the app's access to any health category in the Health app or in Settings › Privacy & Security › Health.
- In the app you can set health data use to "Ask every time" or off, and turn off background sync (which deletes the summaries this device uploaded to the Host).
- You can disconnect your paired Host or delete the app.
- Because we hold none of your personal data, requests to access, correct or delete data can usually be carried out directly on your device or Host. If you need help, contact us using the channel below. This does not limit any rights you have under applicable law (such as China's Personal Information Protection Law or the EU GDPR).

## 9. Security

Connection credentials are kept in the iOS Keychain. When connecting to your Host over the internet, use `wss://` (TLS encryption) and keep your Host access token safe.

## 10. Changes to this policy

If this policy changes, we will update this page and the effective date above. For material changes we will also give notice on this site or in the app's release notes.

## 11. Contact us

If you have any questions about this policy, please open an issue at [GitHub Issues](https://github.com/mimimaster/piwin/issues).

Operator: Shanghai Hailebei Trading Co., Ltd.
