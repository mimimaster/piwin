# ADR 0065: piwin Live — Provider Registry + Shell Media Drivers, bound to a work session

| Field | Value |
|-------|-------|
| Status | **Accepted — multi-provider; supersedes Codex-only same-week wording** |
| Date | 2026-08-28; revised 2026-08-29; language layers 2026-08-31 |
| Scope | `@piwin/contracts`, `@piwin/voice`, `@piwin/host-runtime`, `@piwin/host-server`, `@piwin/host-transport`, `apps/desktop`, `apps/mobile` |
| Product | [2026-08-28 product](../specs/2026-08-28-codex-live-product.md) · [2026-08-29 provider adapter](../specs/2026-08-29-live-provider-adapter.md) · [2026-08-31 language layers](../specs/2026-08-31-live-language-layers.md) |
| Architecture | [2026-08-28 voice lane](../specs/2026-08-28-codex-live-voice-lane.md) |
| Plan | [execution plan](../plans/2026-08-28-piwin-live-execution-plan.md) |
| Related | ADR 0002, ADR 0036, ADR 0038, ADR 0050, ADR 0056, ADR 0062; subscription OAuth spec |

渠道、设置、建连材料与登记台以 [2026-08-29-live-provider-adapter.md](../specs/2026-08-29-live-provider-adapter.md) 为准。会话准入、单 Host 单通话、挂断不取消已接纳 Run、原始音频不落盘，仍以本文与 2026-08-28 产品规格为准。

2026-08-31 稳定性修订：[Live reliability](../specs/2026-08-31-live-reliability.md)。已落实 owner-scoped bootstrap 重放、settingsRevision 校验、晚到取消清理、真实媒体就绪门、Host 唯一结果回传与可恢复失败 UI。原生 bridge 已验证当前适配器 HTTP 201 → connected；真实设备听感验收仍单独进行。

## Context

Users want low-latency speak/listen/interrupt inside a coding session without
giving the voice model the Agent tool catalog. Community Pi extensions
(`@howaboua/pi-codex-conversion`) already do this by reusing **openai-codex
subscription OAuth** against ChatGPT Codex backend Live
(`…/codex/realtime/calls?intent=quicksilver&architecture=avas`, model
`gpt-live-1-codex`), then turning client `delegation` events into Pi user
turns.

An earlier same-day draft of this ADR proposed OpenAI **Platform** Realtime as
the Codex subscription path and made it the only Live configuration surface.
That path does not match the referenced extension and splits Live from the
Accounts login users already have. The product owner rejected that coupling
(`AGENTS.md` §0.1). OpenAI-compatible providers are still supported separately:
their explicitly marked `realtime-audio` models are discovered from Models
settings and exposed as Live routes.

## Decision

### 1. Two registries

Host registers **Provider Adapters** by `providerId` (auth, settings schema,
start bootstrap, close). Each media-capable shell registers **Media Drivers** by
`mediaDriverId` (mic, connect, parse vendor events, write back). Public
contracts stay product-shaped. First period: `openai-codex` +
`google-gemini`.

### 2. Auth stays on Host; one-shot owner bootstrap is the exception

- Codex: existing `openai-codex` subscription OAuth. Long-lived access token
  never leaves Host.
- Gemini: Host-held Gemini API key. Host mints a one-use constrained
  ephemeral token.
- Long-lived credentials never leave Host. A one-shot owner bootstrap
  (Codex SDP answer, or Gemini ephemeral token + fixed endpoint) may appear
  only in that owner's `voice/live/start` response and owner memory.

Codex and Gemini Live are not chat `ModelRef`s. For the OpenAI-compatible Live
channel, a model marked `ModelCapability: 'realtime-audio'` in Models settings
is the source of truth; Live settings select among those discovered routes.

### 3. The active shell owns media; Host owns the call

```text
Desktop or paired Mobile Media Driver (selected by mediaDriverId)
  → HostCommand voice/live/* (owner-only bootstrap)
  → LiveCallCoordinator → Host Provider Registry
```

Host does not PCM-relay audio. Wire details stay in the matching adapter and
Driver.

### 4. Delegation = upstream client delegation → Host admission

Voice does not receive the Agent/MCP tool catalog. Work enters the bound
session only when Host admits a normalized client-delegation event. Keyword
heuristics are forbidden. Spoken “handed to Agent” only after Host receipt.

Busy sessions **steer** the current Run. Live may abort only with the protocol token `STOP_CURRENT_RUN` (the voice model decides; Host does not guess from user speech). Steer failure may fall back to a queued turn. Ending Live does **not** cancel an admitted Run. Host strips ASR tags such as `[clear throat]` and rejects filler-only instructions.

Work-session **chat** model is not a Live field. Composer picker commits
desired profile with `session/set-composer-profile` (session index
`record.model` / `thinkingLevel`). `sessionModels` remains last-applied
runtime. `voice-delegation` `session/prompt` omits `input.model`; Host
resolves `desired = input.model ?? record.model ?? sessionModels` on that
turn (same-provider `setModel`, cross-provider runtime replacement).
Live owner events, `LiveCallSlot`, and `admit-voice-delegation` must not
carry a work `ModelRef`.

Language-model boundaries (2026-08-31): the voice model sees only
`PIWIN_LIVE_SPOKEN_CONTRACT` plus a channel appendix; the work model sees a
one-time `live_work_session` preamble and per-turn `voice_brief`; results
return as a speakable takeaway, not a “session finished” announcement.
Desktop shows a handover card, not a typed user bubble. Host still must
not keyword-guess intent. Details:
[2026-08-31-live-language-layers.md](../specs/2026-08-31-live-language-layers.md).

### 5. Retention

| Data | MVP default |
|------|-------------|
| Raw audio | Not persisted |
| Casual Live transcript | Not persisted |
| Delegated instruction + `voice-delegation` source | Persisted |
| Token / SDP / upstream payloads | Memory only |

### 6. Multi-client (MVP)

One active call per Host; owner-only start/mute/end/SDP; a loopback Desktop or
one authenticated paired Mobile device may become the owner; others see
sanitized `LiveCallView`; browse OK, no silent rebind; owner disconnect grace;
Host restart ends the call.

### 7. Connection state and authorization failures are explicit

Desktop renders the Live surface as soon as local media setup begins; it does
not wait for Host to publish an active call. Local peer phases and sanitized
Host call phases jointly drive opening-microphone, connecting, active,
reconnecting, and failed UI states. A failed start remains visible with retry
and dismiss actions instead of collapsing back to the idle composer button.

The adapter maps an upstream HTTP 403 to the stable contract error
`live-provider-access-denied`. This denotes that the private call-create
request was denied; it does not by itself prove that the account lacks the
official ChatGPT Voice product. It is distinct from expired authentication and
generic protocol failure, and must not be hidden by peer cleanup or abort
races. A verified example is the legacy Realtime voice `alloy`: the Codex Live
v3 endpoint returned 403, while the same account, SDP, and headers returned 201
with the supported voice `cove`. The adapter therefore validates the private
v3 voice catalog and defaults unknown values to `cove` before sending.

Codex Live intelligence is **off**. 2026-08-31 AVAS returned 400
`Unknown parameter: 'intelligence'`. `CODEX_LIVE_INTELLIGENCE_ENABLED` is
false: the setting is hidden, call-create omits the field, leftover config
values are ignored.

The adapter preserves SDP framing across the Host boundary. In particular, it
normalizes answers to CRLF and retains the final line terminator: macOS WebKit
rejects an otherwise valid answer without that terminator as `Invalid SDP line`,
even though the native helper accepts it.

## Consequences

### Positive

- Matches referenced extension auth story: login once in Accounts.
- No duplicate Live model catalog: OpenAI-compatible routes reuse the model
  editor's `realtime-audio` capability, while Codex/Gemini keep their own Live
  settings.
- Clean `@piwin/voice` boundary; Agent path unchanged.
- The same Host authority and Live wire work from Desktop and paired Mobile.
- Low-latency media without Host PCM tax.

### Negative / risks

- Depends on a **non-public** ChatGPT backend Live contract; churn and
  third-party authorization failures are expected operational risk.
- Official ChatGPT Voice entitlement does not establish that a Codex OAuth
  token may call the private Live endpoint from a third-party client. Product
  copy must preserve that distinction rather than blaming the user's plan.
- Must isolate adapter + fixtures; product copy must stay honest.
- WebRTC-in-Tauri remains an R1 risk.

## Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Platform Realtime + `realtime-audio` ModelRef as MVP | Wrong product; no such catalog in the reference path |
| TUI extension compatibility layer | Wrong renderer |
| Host PCM relay as default | Cost/latency; not needed if WebRTC works |
| Keyword delegation | Mis-fires; soft success without Host admission |
| Abort busy Run on hangup | Violates Session/Run authority |
| Voice inside `agent-host` | Breaks Pi-only package boundary |

## Acceptance

R0 docs must match this ADR and the 2026-08-29 provider-adapter spec. Codex
path: authenticated create + Desktop WebRTC. Paired Mobile uses the same
Codex WebRTC contract and the PCM drivers for Gemini/OpenAI-compatible routes.
Long-lived credentials never leave Host; one-shot owner tokens are
start-response-only. Limited Beta still needs product §9–§10 gates.
