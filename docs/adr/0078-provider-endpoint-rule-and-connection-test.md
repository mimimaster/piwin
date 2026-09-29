# ADR 0078: One provider URL rule, and "Test connection" means "can it chat"

Status: Accepted (2026-09-28)

## Context

A user added Volcengine Ark Agent Plan (`https://ark.cn-beijing.volces.com/api/plan/v3`)
as a custom OpenAI-compatible provider. "Test connection" showed a red
**连接失败: Model discovery failed (404 Not Found)**, even though the address and
key were correct. Three problems were behind it:

1. **Test connection was catalog discovery.** The button called `models/discover`
   (`GET {base}/models`). Agent Plan, like many gateways, has no usable `/models`,
   so a harmless "no catalog" answer showed up as a connection failure.
2. **Host code used three different URL rules.** Pi's runtime hands `baseUrl`
   verbatim to the vendor SDKs (`{base}/chat/completions`, `{base}/responses`,
   Anthropic `{base}/v1/messages`). Discovery used `/v\d+$/`, while `models/test`,
   structured completion and vision delegation used `endsWith('/v1')`. For
   `/api/v3`, `/api/plan/v3` and `/api/paas/v4` those last three posted to
   `…/v3/v1/chat/completions`. The single-model test failed on configs that chat
   fine, and Walkthrough and vision delegation broke on them.
3. **`chatApi` was not wired.** ADR 0043 made provider-level `chatApi` "the real Pi
   transport", but the Pi registration (SDK and worker), the worker envelope,
   `models/test` and the Desktop draft all ignored it or dropped it on save.

## Decision

### One endpoint rule (`host-runtime/src/provider-endpoint.ts`)

Every Host-owned call to a configured provider resolves its URL through
`resolveProviderChatEndpoint`, which mirrors Pi exactly:

| Effective `chatApi` | URL |
|---|---|
| `openai-completions` (default for OpenAI-compatible) | `{baseUrl}/chat/completions` |
| `openai-responses` | `{baseUrl}/responses` |
| `anthropic-messages` | `{baseUrl}/v1/messages` |
| `google-generative-ai` | `{baseUrl}/models/{id}:generateContent` |

No `/v1` is ever inserted. A probe that passes therefore means the Pi request
goes to the same place, and a versionless base such as `http://127.0.0.1:8799`
is tested the way Pi will actually call it.

Structured completion and vision delegation send Chat-Completions-shaped bodies
(`response_format`, `image_url`). They force `openai-completions` even on a
Responses provider, but still follow the rule. Model **discovery** is the one
deliberate exception: it only imports a catalog and keeps its lenient `/v1/models`
fallback.

### `models/test-connection` returns a verdict (contracts: `ProviderConnectionTestResult`)

- If the row has an enabled chat model (or the caller names one), the Host sends
  one minimal generation request through the rule above, using the effective
  transport. This is the truth.
- Otherwise the Host falls back to discovery.
- The command succeeds whenever the Host could run the probe. The `outcome`
  carries the provider's answer:
  - `chat-ok` / `catalog-ok` → green.
  - `catalog-unavailable` (discovery got 404/405/non-list) → amber warning:
    "no model list, chat unaffected, add IDs manually". The rail dot is not red.
  - `auth-failed` (401/403), `model-rejected` (other HTTP), `unreachable`
    (DNS/TLS/timeout) and `invalid-config` → red.
  - On a chat 404, the copy suggests the other OpenAI transport.
- Shells map outcomes to tone and copy (`apps/desktop/src/provider-connection-verdict.ts`).
  They never parse error strings.

The "fetch models" action in the model list still calls `models/discover`. A
catalog-less answer (404/405 or a non-list body) is no longer a command
failure: the Host returns `models: []` plus `catalogUnavailable`, and Desktop
shows an amber notice near the list ("no model list, chat unaffected, add IDs
manually") instead of a red error. Auth (401/403), 5xx, timeout and network
errors still fail the command.

### `chatApi` is honoured end to end

- `resolvePiApiForProvider(protocol, chatApi)` registers `openai-responses` for
  OpenAI-compatible rows. Other combinations fall back to the protocol default.
- The same applies to the worker/RPC registration, through the
  `chatApi` field on `SerializableProviderRuntime` / `SubagentProviderEnvelope`.
- The Desktop draft round-trips `chatApi`. Advanced → **对话协议 / Chat API**
  (Chat Completions | Responses) edits it, and the hint shows the resulting URL.
- An omitted `chatApi` still means Chat Completions (ADR 0043 is unchanged).

### Presets

- Volcengine Ark pay-as-you-go remains a vendor preset (`/api/v3`). Agent Plan
  (`/api/plan/v3`) is not a product preset: users add it as a custom
  OpenAI-compatible endpoint and type model IDs by hand. Catalog-less 404s are
  handled by the generic discovery rule above, not a shipped model table.

### Test isolation

- Tests never fall back to the real `~/.piwin`.
- `vitest.piwin-root-isolation.ts` (repo root, referenced from the `setupFiles`
  of host-runtime, agent-host, host-server and cli) gives each test file a temp
  `PIWIN_ROOT` / `PIWIN_PI_AGENT_DIR`.
- The leaking mock-HostRuntime tests now pass explicit roots.
- `scripts/prune-test-polluted-sessions.mjs` moves already-leaked
  `/tmp/project` sessions to `<root>/trash/`. It is a dry run by default and
  refuses to run while a Host owns the root.

## Consequences

- An Anthropic-compatible base that already ends in `/v1` now fails the probe,
  auxiliary completions and vision delegation, just as Pi's chat always did.
  Remove the trailing `/v1`.
- A versionless OpenAI-compatible base (no `/v1`) is no longer silently "fixed"
  by probes. If the gateway only serves `/v1/chat/completions`, the test now
  reports it, and chat was already failing.
- Host auxiliary calls (Walkthrough, reply writer, vision delegation) stay on
  Chat Completions. A provider that serves only Responses cannot run them yet.
- Remaining `homedir()`-direct defaults (doc-rag root, host-server pairing
  fallback, browser profile) are not covered by the test setup. Their callers
  must pass a root.
