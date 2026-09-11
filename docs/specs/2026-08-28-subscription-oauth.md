# Spec — Pi-native subscription OAuth

| Field | Value |
|-------|-------|
| Status | **Draft (rev 5) — implementation authority** |
| Date | 2026-08-28 |
| Packages | `contracts`, `agent-host`, `host-runtime`, `host-server`, `host-transport`, `apps/desktop`, `apps/cli`, `apps/mobile` |
| Principle | Reuse Pi `ModelRuntime.login/logout`. Cards require stored `type: "oauth"`. Accounts ≠ channels. Do not become CPA. **Allowlist = Pi builtins that expose oauth login.** |
| Amends | ADR 0004, ADR 0012, ADR 0028, ADR 0038 |
| Related | [model-catalog-integration.md](./model-catalog-integration.md), ADR 0048, ADR 0056, [multi-client-concurrency.md](./multi-client-concurrency.md) |
| CPA reference | Local CLIProxyAPI: `auth-dir` vs `openai-compatibility`, docker ports `1455` (Codex) / `54545` (Claude), fsnotify watcher with coalesced add/modify/delete. |

**Rev 5 product cut:** Cards are Pi **subscription** OAuth (`isSubscription`): `kimi-coding`, `openai-codex`, `anthropic`, `xai`, `github-copilot`. OpenRouter is a BYOK key channel, not a 套餐. Radius is a gateway helper. Antigravity is not in Pi. Logging into `anthropic` relocates a colliding BYOK channel to `anthropic-api`.

This revision is the closed design. Leftover work is implementation, not open product questions.

---

## 0. Product decision

piwin is a Host-first **agent**, not a proxy.

| Layer | piwin | CPA (local reference) |
|-------|-------|------------------------|
| Upstream OAuth files | `{PIWIN_ROOT}/pi-agent/auth.json` (Host-owned Pi `auth.json`) | `auth-dir` many `*_oauth_*.json` |
| Channels | `config.providers[]` BYOK | `openai-compatibility` + yaml API keys |
| Downstream client keys | none (we are the client) | `api-keys:` on `:8317` |
| Multi-account rotation | out of scope | `routing.strategy: round-robin` |

- **Accounts:** Pi stored OAuth for the five v1 `isSubscription` ids only.
- **Channels:** BYOK / CPA / OpenRouter key / Ollama, etc. OpenRouter is never a 套餐 card.
- **Claude 套餐:** `anthropic` is a v1 account. A colliding BYOK channel relocates to `anthropic-api`.

Do not reimplement PKCE, stuff tokens into `apiKeyRef`, or register OAuth models as openai-compatible.

---

## 1. Goals / non-goals

**Goals**

1. Desktop/CLI log into Pi subscription OAuth and pick those catalog models.
2. Remote Host works day one (browser URL + paste the localhost callback).
3. Existing CPA + `openai` / `custom-openai` keep working. Stock `anthropic` BYOK relocates to `anthropic-api` if the user logs into Claude OAuth.
4. SDK and RPC both resolve allowlisted oauth from the same `auth.json`.

**Non-goals (v1) — closed, not deferred-in-the-same-breath**

| Out | Closed reason |
|-----|----------------|
| Radius card | Pi helper that needs a gateway URL, not a consumer subscription. |
| Antigravity | Not a Pi builtin. Do not invent cards. |
| Multi-account round-robin | CPA. Pi is one credential per id. |
| Mobile-initiated login | Consume accounts only; ignore `auth/prompt`. |
| Becoming CPA | No `:8317`, no quota rotation, no Codex-as-Claude. |

Native subscription cards seed **real extra surfaces** the OAuth can call (Codex Images, Grok Imagine image/video) onto the same provider row. They are tagged `image-generation` / `video-generation` and routed over HTTPS, not `oauth://`. This is not a CPA dump: no gpt-4o on Codex, no protocol disguise. ASR still stays on channels.
| Account email in UI | Pi `listCredentials` is `{ providerId, type }` only. |

---

## 2. Vocabulary

| Term | Meaning |
|------|---------|
| **Channel** | `ModelProviderConfig` in `~/.piwin/config.json`. |
| **Account** | Stored `type: "oauth"` in `auth.json` for a **v1 allowlisted** Pi id. Env keys and stored api_key are not accounts. |
| **Pi provider id** | From `ModelRuntime.getProviders()`. |

---

## 3. Identity

### 3.1 v1 allowlist (Pi 0.84.2)

| Card | Pi id | Pi API | Surface | Stock BYOK preset collision |
|------|-------|--------|---------|------------------------------|
| Kimi Code | `kimi-coding` | `anthropic-messages` | **v1** | No stock preset |
| ChatGPT Codex | `openai-codex` | `openai-codex-responses` | **v1** | No (`openai` is GPT API key) |
| Anthropic / Claude | `anthropic` | `anthropic-messages` | **v1** | Yes — relocate to `anthropic-api` |
| Grok / X | `xai` | native xAI | **v1** | Only if user created id `xai` |
| GitHub Copilot | `github-copilot` | mixed | **v1** | No stock preset |
| OpenRouter | `openrouter` | openai-compatible | **channel** | Key in Models. Pi has an oauth helper; we do not card it. |

`auth/login` / composer subscription merge / Desktop cards: **these five rows**.

`auth/login openrouter` / `antigravity` → `unsupported-subscription-provider`.

Allowlist is Pi `oauth.isSubscription` builtins. Request shape stays Pi’s.

### 3.2 Hard rules

1. Accounts still live in `auth.json`. Login also seeds a Models-page Provider with `source: 'subscription'` so the user can inspect params, toggle models, and set defaults.
2. That seeded row is **not** a BYOK channel. Compile still skips `registerProvider` and uses `{ auth: { kind: 'oauth' } }`.
3. Channels never write `auth.json`. Collision is only a BYOK channel (`source !== 'subscription'`) that steals a v1 id.
4. Collision = **any** persisted channel (enabled or disabled) whose `id` is a **v1 allowlisted** id. Stock `anthropic` **is** a collision when Claude OAuth logs in — relocate to `anthropic-api`. `openai` is not (`openai-codex` is a different id).
5. `settings/apply` refuses a channel id that matches a v1 account in `logged-in` / `logging-in` / `sync-error` / `needs-reauth`, except relocate Phase A. Add-channel UI may auto-allocate `{id}-2`.
6. Same model **name** on two sources is allowed (`xai::grok-4.6` vs `custom-openai::grok-4.6`).

### 3.3 Typical user (this machine)

```
Accounts:  openai-codex  and/or  xai
Channels:  custom-openai  http://127.0.0.1:8317   (CPA: Claude, mixed, Imagine)
           anthropic      api.anthropic.com         (API key, unchanged)
Composer:  [套餐] gpt-5.4-codex , grok-4.6
           [通道] CPA / claude-sonnet-… , CPA / grok-4.6 , Anthropic / …
```

CPA docker-compose publishes `127.0.0.1:1455` and `54545` for **CPA’s** Codex/Claude login. piwin Codex login also uses Pi’s Codex loopback (`localhost:1455`). See §21.1 — do not run both logins at once.

---

## 4. Storage and runtimes

| What | Where | Owner |
|------|-------|-------|
| OAuth | `{PIWIN_ROOT}/pi-agent/auth.json` 0600 | Host-owned Pi `ModelRuntime` / `CredentialStore` |
| Channel keys | `~/.piwin` keychain / `secrets/` | `SecretResolver` |
| Channels | `config.providers[]` | settings/apply |
| Default chat | `defaultProviderId` + `defaultModelId` | may be a v1 account; first login may seed |

No tokens in config, JSONL, logs, diagnostics, journal, or remote projection.

**One Host auth runtime** for login/status/logout. Session SDK/RPC `ModelRuntime.create()` for prompts only — they never `login()`/`logout()`.

**Do not share with Pi CLI by default.** `pi` still reads `~/.pi/agent/auth.json`. Host login/logout only mutates `{PIWIN_ROOT}/pi-agent/auth.json`. The default `~/.piwin` root may copy the legacy Pi file once if the Host file is missing; test/custom roots never inherit it.

**Watch Host `auth.json`** (CPA pattern: fs events, coalesce add/modify/delete per provider id, debounce). External edits of the Host file → `auth/updated`. If a **v1** oauth **disappears**, §7.4 (cancel matching Runs, teardown, then treat as logged-out). Anthropic oauth appearing/disappearing in the file does **not** change the product picker.

If `auth.json` is missing, Pi `ModelRuntime.create` may create an empty file; Host does not chmod it world-readable. If the file is corrupt, `auth/status` fails with mapped `auth-store-unreadable`; cards show logged-out; do not delete the file automatically.

---

## 5. Contracts

### 5.1 Auth descriptor

```ts
export type ProviderAuthDescriptor =
  | { readonly kind: 'env'; readonly envName: string }
  | { readonly kind: 'bootstrap'; readonly secretId: string }
  | { readonly kind: 'inline'; readonly apiKey: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'oauth'; readonly providerId: string };
```

Worker JSONL: `oauth` carries no secret. Worker must not `registerProvider` that id.

### 5.2 ModelRef

```ts
export type ModelSource = 'channel' | 'subscription';

export type ModelRef = {
  providerId: string;
  modelId: string;
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  source?: ModelSource; // required on new writes
};
```

**`resolveChatModel`**

1. `source === 'subscription'` → v1 allowlist + `isUsingSubscription` + Pi catalog + no channel with that id.
2. `source === 'channel'` → `findEnabledProvider` + `findEnabledModel`. Ignore accounts.
3. Omitted (legacy): enabled channel with that id → channel; else v1 logged-in account → subscription; else unavailable.
4. Explicit source always wins. `source: 'subscription'` + allowlisted logged-in account → subscription models. Unknown ids stay unavailable.

Thinking for subscription: `modelRuntime.getModel(…).api`, not BYOK protocol.

`ConfiguredChatModel`: add `source`, `group`. Remote projection must keep subscription rows **without** BYOK protocol.

### 5.3 Commands

Exclusive Host job + single-consume prompt tickets.

| Command | Role |
|---------|------|
| `auth/status` | Accounts + collisions + `activeLogin` (sanitized) |
| `auth/login` | `{ providerId, relocateChannelId? }` → `{ loginId }`. `ownerDeviceId` = `pairedDeviceId` ?? stable `clientId` |
| `auth/respond` | Owner or claimer only → else `auth-not-owner` |
| `auth/cancel` | Owner/claimer; also Host restart/timeout |
| `auth/claim` | Only if `ownerConnected === false` |
| `auth/logout` | §7.4 |

`relocateChannelId` = existing colliding **channel** id. Host generates the new channel id. Not DB-atomic with OAuth.

Idempotency: `(devicePrincipalId, idempotencyKey)` on `auth/login` as other exclusive jobs. Retry with the same key returns the same `loginId` if still in flight.

`settings/apply` during an active login: allowed for unrelated domains; **refuse** `providers` mutations that touch the colliding id except Phase A already committed. Second `auth/login` → `auth-busy`.

### 5.4 Pushes

```ts
auth/prompt        // inbox, ephemeral, journal: false
auth/updated       // global projection, journal OK
auth/login-finished // ephemeral, journal: false, mapped error only
```

**Pi interaction mapping**

| Pi | Payload | UI |
|----|---------|-----|
| `auth_url` | `url`, `instructions?`, `links?` | Open/copy; show instructions |
| `device_code` | `userCode`, `verificationUri`, intervals | Large code |
| `info` / `progress` | `message`, `links?` | Status |
| `select` | `options: { id, label, description? }` | List |
| `text` / `secret` / `manual_code` | `message`, `placeholder?` | Field; never log value |
| prompt abort | `prompt-cancelled` + `promptId` | Drop stale field |

`HostEgressHub.emitCanonical`: skip journal when policy `journal: false`. Reconnect uses `auth/status.activeLogin.currentPrompt` (still-valid, no secrets).

### 5.5 Account state

`logged-out` \| `logging-in` \| `logged-in` \| `needs-reauth` \| `sync-error`

`surface: 'v1' | 'ignored'` (`ignored` is reserved; v1 allowlist has no ignored ids).

No email. `accountLabel` optional later; v1 omit.

`ActiveLoginStatus`: `loginId`, `providerId`, `ownerDeviceId`, `ownerConnected`, `startedAt`, `currentPrompt?`, `authUrl?`.

---

## 6. agent-host

`subscription-auth.ts`. Use `listCredentials` + `isUsingSubscription`. **Not** `checkAuth()`.

Env `XAI_API_KEY` / stored api_key → card `logged-out`. BYOK channel may still use the env key under a **different** channel id.

`login(id, 'oauth')` / `logout(id)` only for allowlisted ids.

**`CredentialSynchronizationError`:** credential already committed. Re-read store. Login + oauth present → `sync-error`, `ok: true`, `credential-sync-failed` (do not re-login). Logout + oauth gone → logged-out. Login throw + no oauth → `ok: false`.

Session ModelRuntime: create from `auth.json`; register **channels only**; oauth ids skip register; no `buildPiProviderRegistration` for Codex Responses.

---

## 7. host-runtime

### 7.1 Relocate (only `xai` / `github-copilot` / `openai-codex` if a user created those ids)

Stock Anthropic/OpenAI presets **never** enter this path.

Phase A (config, before Pi login):

1. Collision = any channel with that allowlisted id.
2. No matching `relocateChannelId` → refuse, no token, no rename.
3. Rename (not disable). New id from `allocateUniqueProviderId` in **`@piwin/contracts`** (move off Desktop). Prefer `${oldId}-api`. Name “{oldName}（API Key）” if free.
4. Rewrite every channel ref to the old id: defaults, composer restore, reply-writer, vision, image/video/ASR, subagent profiles, orchestration, `web.searchDelegateModel`, `walkthrough.custom.model`. Tests fail if a new `ModelRef` field is added without this list. Keep `source: 'channel'`.
5. Persist as `settings/apply` providers domain.
6. Phase A failure → abort, config unchanged.

Phase B: Pi oauth login. Cancel/fail → **keep Phase A**. `login-finished.newChannelId` retargets the drawer.

Logout does not rename back.

### 7.2 Resolve and defaults

| Caller | v1 |
|--------|----|
| Prompt / compile / ADR 0048 switch | `resolveChatModel` |
| Subagent preflight | Same; no keychain for oauth |
| Vision, reply writer, session naming | `resolveChatModel` or `resolveDefaultChatModel` |
| Image / video / ASR | Channels only |
| Embedding / rerank | Channels only |
| Walkthrough custom | Channels only (protocol union is BYOK) |
| Web search **delegate** | Channels only |
| Native search on subscription chat | Pi model capabilities; unknown → fallback external `web_search` |
| `models/test` | Pi smoke, no one-shot key |
| `models/discover` | Channels only |

**`resolveDefaultChatModel`**

1. Configured default if `resolveChatModel` succeeds.
2. First **logged-in** v1 account in `V1_SUBSCRIPTION_PROVIDER_IDS` order + that provider’s first Pi **chat** catalog model.
3. ADR 0028 channel priority.
4. Undefined.

First successful v1 login seeds default **only if** step 1 currently fails. Relocate that left a working channel default is not overwritten.

429 / quota on a subscription model: existing `provider-quota` / `provider-rate-limit` → switch-model. Do not flip `needs-reauth` unless refresh/auth actually failed.

### 7.3 Compile

Channels → existing envelope. Subscription → `{ auth: { kind: 'oauth', providerId } }`. Least-scope. Missing oauth → `provider-authentication`, not a CPA 401.

### 7.4 Logout

1. Cancel Runs + queued turns compiled to that providerId. Copy: 退出会中断该套餐对话，并退出本机 Pi CLI 同一账号.
2. Wait **runtime/worker teardown** (no cached `getAuth`), then `logout`.
3. `auth/updated` + new-runtime.

Do not wait for the agent loop to finish by itself.

### 7.5 Settings vs auth

Account-only login does not bump settings `revision` unless it seeds defaults. Picker follows `auth/updated` + refetch `auth/status` / `models/configured`.

HTTP(S)_PROXY: login and model calls use the same process env Pi already honors. No extra product proxy UI.

---

## 8. Session path

```
selectedKey openai-codex::…
  → model { source:'subscription', providerId, modelId }
  → resolveChatModel → compile oauth envelope
  → skip registerProvider → getModel → Pi Codex Responses + refresh
```

CPA channel path unchanged.

---

## 9. Picker

`models/configured`:

1. Enabled channel chat models.
2. v1 accounts in `logged-in` or `sync-error` without collision (oauth on disk). Copilot: `availableModelIds`.
3. `needs-reauth`: omit models; 重新登录.
4. `ignored`: omit (empty list in v1).

Groups: 套餐 then 通道. Image/video/speech pages: channels only.

Usage ledger: show tokens as today. Catalog cost for subscription models may be 0/unknown — do not invent Plus-plan remaining quota (CPA has usage persistence; we do not in v1).

---

## 10. Remote and multi-client

| Topic | Rule |
|-------|------|
| Tokens | Host `auth.json` |
| Remote Host | Codex/Claude default to browser OAuth. Show the authorize URL and accept a pasted `localhost` callback. xAI/Copilot stay device code. |
| Local sidecar | Same browser + paste flow. Owner id = stable `clientId`. |
| Owner | Only owner respond/cancel |
| Disconnect | Keep login until 15 min idle or Pi device-code expiry. Other Desktop/CLI `auth/claim` if owner disconnected. Owner reconnect wins over pending claim. |
| Reconnect | `auth/status.activeLogin`, not journal |
| Mobile | Ignore `auth/prompt`; consume configured models |
| Admission | `auth/*` allowed for paired devices |
| Journal | prompts/finished not journaled |

Never complete OAuth in Desktop and ship refresh tokens to Host.

---

## 11. Desktop UI

Settings → 模型：登录后必须出现对应套餐 Provider（可展开改参数 / 开关 / 默认）。凭证抽屉不出现。套餐行标 `OAuth 套餐`。

Settings → 模型 → 文本选择器：订阅 **above** 通道.

Settings → **OAuth 登录**: one card per Pi subscription (Kimi, Codex, Claude, Grok, Copilot). Idle featured card is Kimi. OpenRouter stays a key channel. States: 未登录 / 登录中 / 已登录 / 需重新登录 / 已登录同步失败.

Anthropic BYOK channel stays until Claude OAuth login, then relocates to `anthropic-api`. If `xai` is logged in and user adds xAI as channel → allocate `xai-2`. OpenAI preset remains `openai`; Codex is the account.

Login modal: full prompt mapping; owner-only submit; others 登录进行中 + 接管 if disconnected.

Composer grouped; vanished keys → `resolveDefaultChatModel`. `provider-authentication` on a v1 id deep-links to that card.

Empty: 或用套餐登录 Codex / Grok / Copilot. Accounts-only works via §7.2. Collision hides that account’s models until relocate.

Tauri: `open` system browser for `auth_url` on **local** Host only.

---

## 12. CLI

```
piwin auth status
piwin auth login openai-codex
piwin auth login xai
piwin auth logout openai-codex
piwin auth claim <loginId>
```

Stdout prompts; stdin paste of the callback URL. Codex/Claude default to browser OAuth, not headless device code. Doctor: five v1 states.

---

## 13. Mobile

Picker + send for logged-in v1 accounts. No login UI. Ignore `auth/prompt`.

---

## 14. Errors (mapped, no Pi bodies)

| Case | Code |
|------|------|
| Not logged in / needs-reauth | `provider-authentication` |
| Refresh fail mid-run | run fails auth; account `needs-reauth` |
| Quota 429 | existing quota codes; not reauth |
| Collision | `collision`; no token; no rename |
| `auth/login` unknown (e.g. antigravity) | `unsupported-subscription-provider` |
| Sync after commit | `credential-sync-failed` |
| Busy / not owner / stale prompt | `auth-busy` / `auth-not-owner` / `ticket-consumed` |
| Loopback port in use (CPA Codex login on 1455) | `oauth-callback-port-busy` — 请先结束 CPA/其他工具的 Codex 登录 |
| Auth store unreadable | `auth-store-unreadable` |
| Copilot model not enabled | mapped from Pi; copy: 在 VS Code Copilot 中启用该模型 |
| Cancel / timeout | `ok: false`; no transcript error |

---

## 15. Security

| Field | Log | Persist | Journal | Fan-out |
|-------|-----|---------|---------|---------|
| `auth/respond.value` | No | No | No | Never a push |
| Authorize URL query | No | No | No | Live prompt only |
| Device userCode | No | No | No | Live + `activeLogin` |
| Pi token-exchange body | No | No | No | Mapped error |
| Tokens | No | `auth.json` 0600 | No | No |

Remote paired devices may start login (Host is the user’s machine).

---

## 16. Migration

1. `openai` BYOK: untouched. Codex is `openai-codex`.
2. `anthropic` BYOK: relocates to `anthropic-api` on Claude OAuth login.
3. CPA `custom-openai`: untouched (Imagine and gateway Claude stay here).
4. Existing Pi CLI oauth for any allowlisted id: cards `logged-in` if stored oauth.
6. New `ModelRef` writes always set `source`.
7. User-created channel id `xai` + Grok login: relocate as §7.1.

---

## 17. Tests

- Env API key / stored api_key ≠ subscription logged-in.
- `auth/login antigravity` rejected; composer has Anthropic 套餐 when logged in.
- `openai` channel + `openai-codex` account coexist without relocate.
- Relocate only for allowlisted channel ids; every ModelRef writer rewritten.
- settings/apply colliding v1 id rejected; disabled same-id is collision.
- Journal skip; reconnect via status; secrets not in logs/errors.
- Remote auto device_code; local may show Codex select.
- Owner / claim / mobile ignore prompt.
- Logout: cancel → teardown → delete; auth.json watch delete cancels Runs.
- `CredentialSynchronizationError` → sync-error not re-login.
- Port busy mapped.
- `allocateUniqueProviderId` in contracts.
- Accounts-only default seed.
- Walkthrough / search-delegate / image-gen reject subscription refs.

No live OAuth in CI.

---

## 18. Docs / ADR (same PR as implementation)

- ADR 0004: vendor login for the five Pi subscription providers, including Anthropic OAuth.
- ADR 0012: `kind: 'oauth'`.
- ADR 0028: default fallback includes v1 accounts.
- ADR 0038: non-journaled auth prompts.
- getting-started.md: BYOK channels + five 套餐 cards. OpenRouter stays a key channel.

---

## 19. Implementation sequence

1. Contracts, `auth/status`, five cards, models/configured picker, journal flag.
2. agent-host read path + five-id allowlist (Radius / Antigravity rejected).
3. login/logout + relocate for colliding channel ids + Run cancel/teardown.
4. Remote device-code, owner/claim, watch, port-busy.
5. Defaults, resolver coverage, CLI, Mobile consume accounts only.

---

## 20. Checklist (implementation, not open questions)

- [ ] Pi login/refresh/catalog/request shape reused
- [ ] Status from stored oauth / `isUsingSubscription`
- [ ] Five v1 cards including Anthropic / Claude
- [ ] Claude OAuth relocates a colliding BYOK `anthropic` channel
- [ ] Collision + relocate only for allowlisted ids
- [ ] ModelRef source rules
- [ ] registerProvider skip oauth
- [ ] Worker JSONL no secrets
- [ ] SDK + RPC
- [ ] Defaults including accounts-only
- [ ] Prompt mapping complete
- [ ] States including sync-error (models still listed)
- [ ] Owner/claim/disconnect/mobile
- [ ] Ephemeral journal
- [ ] Logout teardown then delete
- [ ] auth.json watch (CPA-style coalesce)
- [ ] Port 1455 busy vs CPA
- [ ] Secrets on requests
- [ ] Ignored extra Pi oauth helpers (empty list in v1)
- [ ] Tests in §17

---

## 21. Operational closures (were “nits”; now decided)

### 21.1 CPA callback ports

Local CPA `docker-compose` binds `127.0.0.1:1455` (Codex) and `54545` (Claude). Pi Codex browser login also uses `http://localhost:1455/auth/callback`.

- piwin **local** Codex browser login while CPA Codex login is listening → bind fail → `oauth-callback-port-busy`.
- Claude port 54545 is CPA’s Claude login, not Pi Anthropic OAuth. Pi Anthropic login does not bind 54545.
- xAI / Copilot use device code; no 1455.
- Running CPA as an **API gateway** on 8317 does **not** take 1455 unless someone is in CPA’s oauth login. Normal 8317 use + piwin Codex login can coexist.
- Do not rebind Pi’s port. Do not kill CPA.

### 21.2 Watcher

Match CPA: coalesce per provider id; last action wins; never block login on the watcher; bursty writes from Pi refresh do not spam `auth/updated` (debounce ≥ 100ms, emit if state fingerprint changed).

### 21.3 Catalog after login

After successful login, `ModelRuntime.refresh({ providers: [id], allowNetwork: true })` once (bounded timeout). Failure → `sync-error` with models from builtin cache if any; retry-sync button. Offline login is impossible; fail clearly.

### 21.4 Copilot

After Pi login it enables models itself. If a model is still “not supported”, mapped error + VS Code enable copy. GHES: `text` prompt for domain (Pi). Empty → github.com.

### 21.5 Grok

`login('oauth')` only (not api_key). Image/video remain CPA. Thinking/compat for grok **channels** stays `GROK_OPENAI_COMPAT`; native `xai` builtin is Pi’s problem, not our openai-completions wrapper.

`GROK_OPENAI_COMPAT` keeps `store` / developer-role off. `supportsReasoningEffort` is **on** so OpenAI-compat grok channels (CPA) send `reasoning_effort` from the UI thinking level. Omitting it lets CPA hard-default upstream `reasoning.effort` to `medium`.

Subscription image/video: Codex `gpt-image-2` (+ 2.5 sunburst/flare) POST `https://chatgpt.com/backend-api/codex/images/generations` with the Codex OAuth bearer. Grok Imagine POST `https://api.x.ai/v1/images/generations` and `/videos/generations` with the xAI OAuth bearer. Chat catalog is unchanged (Pi Responses models).

### 21.6 Thinking levels

Use Pi model `api` / thinking map. Codex high/xhigh as Pi exposes. Do not invent levels.

### 21.7 Host restart

In-flight login aborted; `activeLogin` empty; user starts again. Tokens only exist if Pi already committed; then status reread.

### 21.8 Clock / device code expiry

Pi owns expiry. Host 15 min idle abort is a ceiling. Show countdown from `expiresInSeconds` when present.

### 21.9 IPv6 / localhost

Pi chooses redirect URI. We do not rewrite it. Remote never uses it.

### 21.10 Multiple Desktops

Stable `clientId` per install. Two windows same install = same owner (OK). Two installs = two devices; first login owns.

### 21.11 Subagents

Child compiles its own least-scope envelope. Parent Codex → child Codex oauth skip-register. If child model omitted, `resolveDefaultChatModel`.

### 21.12 Native web search

Subscription chat: Pi capabilities. No channel `nativeSearchAdapter`. If not native-ready, external `web_search` if configured.

### 21.13 Usage UI

Tokens yes. Cost column may be “—” for subscription rows. Remaining **subscription** quota (5h / weekly / product mix) is **not** the usage ledger; it is the OAuth card quota drawer in §22.

---

## 22. Settings → OAuth quota drawer

`auth/quota` / `auth/reset-quota` read the same OAuth material as login (`{PIWIN_ROOT}/pi-agent/auth.json`). Host refreshes an expired access token once via Pi `ModelRuntime.refresh`, then calls the vendor endpoint. Failures become `quota.error` (drawer copy + Retry). Do not invent percentages when the vendor is unreachable.

| Provider | Endpoint | Auth | What we show |
|---|---|---|---|
| ChatGPT Codex | `GET https://chatgpt.com/backend-api/wham/usage` + `…/wham/rate-limit-reset-credits` | Bearer + `ChatGPT-Account-Id` | 5h / weekly `used_percent`, `additional_rate_limits[]` (nested `rate_limit.primary_window`), banked resets |
| Codex reset | `POST …/wham/rate-limit-reset-credits/consume` `{ idempotency_key }` | same | Consumes the next available reset credit |
| Grok / SuperGrok | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` + `/v1/settings` | Bearer + `X-XAI-Token-Auth: xai-grok-cli` | `config.creditUsagePercent`, `productUsage` (GrokBuild / Imagine / Tasks), PAYG `onDemandCap.val`, plan from `subscription_tier_display`. Not `api.x.ai/v1/api-key`. |
| Claude | `GET https://api.anthropic.com/api/oauth/usage` | Bearer + `anthropic-beta: oauth-2025-04-20` | `five_hour` / `seven_day` / scoped weekly `utilization`, extra usage |
| GitHub Copilot | `GET https://api.github.com/copilot_internal/user` | GitHub OAuth Bearer | `quota_snapshots` remaining % + plan |
| Kimi Code | `GET https://api.kimi.com/coding/v1/usages` (fallback `.ai`) | Bearer | weekly `usage.limit/used/remaining` + 5h `limits[]` (`duration: 300 TIME_UNIT_MINUTE`) |

These routes are undocumented vendor surfaces that Codex CLI / Grok Build / Claude Code / VS Code Copilot already call. Parsers must be defensive: missing windows stay omitted; HTTP 401 after refresh → 重新登录.

### 21.14 Proxy / mainland network

Same `HTTP_PROXY`/`HTTPS_PROXY`/`PI_*` as Pi model calls. Device-code verification URL is opened on the **owner’s** browser (user laptop), token poll is on the **Host**. If Host cannot reach `auth.x.ai` / `auth.openai.com`, mapped network error.

### 21.15 First-run auth.json

Do not pre-seed tokens. Empty `{}` is fine.

### 21.16 Windows/Linux remote Host

Same commands. Device code is the remote path. No Tauri on the Host.

### 21.17 Feature flag

None. Ship on; allowlist is the flag.

### 21.18 Telemetry

Provider id + event name only (`auth_login_start` / `finish` / `cancel`). No URLs, codes, tokens.

### 21.19 `openai-codex` as a user channel id

Treat as collision; relocate to `openai-codex-api`. Rare.

### 21.20 Pi `isUsingSubscription` vs allowlist

Status cards iterate allowlist, not every `isSubscription` builtin. Prevents Kimi/Anthropic cards.

This is the closed spec.
