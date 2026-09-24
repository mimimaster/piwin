# ADR 0074: Devin OAuth and tools integration

- Status: accepted
- Date: 2026-09-23
- Related: [0072-builtin-code-search.md](./0072-builtin-code-search.md),
  [docs/research/2026-09-23-devin-oauth-and-search-integration-feasibility.md](../research/2026-09-23-devin-oauth-and-search-integration-feasibility.md)

## Context

piwin already has a Devin-aligned `code_search` tool (ADR 0072). Windsurf
credentials are a separate keychain/env secret. Users who already pay for Devin
want that same login to drive chat, Fast Context, and Devin web search without
pasting a token twice.

Pi's subscription ModelRuntime can `registerProvider('devin', { oauth })` and
`runtime.login`. That path is not flushed by `ModelRuntime.create()` in piwin:
installing `pi-devin-provider` as a Pi extension would only affect Pi TUI.
The provider has to live in `@piwin/agent-host`, the only package allowed to
import Pi.

Devin's HTTP surface is unofficial and reverse-engineered. Same ownership rule
as MCP (ADR 0033): the user opts in with their own account; piwin does not
warrant the vendor API, and a vendor change can break login or search without
a piwin bug.

## Decision

1. **Port the Devin provider into `@piwin/agent-host`.** `devin` is a v1
   subscription OAuth id (`oauth://devin`). `piOauthLoginProviderId('devin')`
   is identity — Devin is not Claude Code. Pi extension `registerProvider` is
   not a substitute; it never reaches piwin's subscription ModelRuntime.

2. **One secret ref, no keychain copy.** Config stores
   `apiKeyRef: 'oauth:<providerId>'` (e.g. `oauth:devin`). Host resolves it
   from `~/.piwin/pi-agent/auth.json`. Do not duplicate the token into
   `keychain:<service>`. `keychain:` remains valid for a pasted Windsurf key.
   Contracts stay honest: `isCodeSearchBackendReady` for `windsurf` is true
   only when `apiKeyRef` or `apiKeyEnv` is present. Host-runtime may auto-fill
   `oauth:devin`; empty refs stay not-ready.

3. **Devin web search is a `WebSearchSourceKind` `'devin'`**, merged into the
   existing Host `web_search` tool. Do not register a second model-visible
   tool named `devin_web_search`. Settings can test it
   (`WebSearchTestableSourceKind` includes `'devin'`). The source reuses the
   same `oauth:devin` ref.

4. **Login is Pi `runtime.login` after `registerProvider('devin', { oauth })`
   on the subscription ModelRuntime.** Local Host uses loopback PKCE (port
   `59653`, fallback `0`). Remote Host uses the existing browser +
   paste-callback `AuthPrompt` kinds (`auth_url`, `manual_code`). This ADR
   does not add a HostAuthPrompt kind.

## Consequences

- Settings gains a Devin subscription card next to Copilot; AUTH_CLI follows
  `V1_SUBSCRIPTION_PROVIDER_IDS`.
- `code_search` windsurf backend and web search can share one Devin login.
- Vendor/API risk is user-owned. Document it on the card; do not hide the
  unofficial client behind a first-party tone.
- Downstream packages (`agent-host`, `host-runtime`, `tools-web`, desktop)
  implement against these contracts in later slices.

## Amendment (2026-09-24)

- **Logged-out accounts are not offered.** `code_search` with `backend: 'windsurf'` resolves an `oauth:<provider>` ref (explicit, or the implicit `oauth:devin` for an empty config) only when that account is present in `auth.json` (`hasOauthCredentialSync`). Otherwise the tool is left out with a composition diagnostic, instead of reaching the model and failing every call.
- **Expired sessions ask for a login.** Devin CLI tokens have no refresh grant. `refreshToken` returns the credentials unchanged while they are valid and throws "log in to Devin again" once `expires` has passed, rather than handing back an expired token that surfaces as a bare 401.
- The Code search settings action is "Use Devin account": it switches the ref, it does not start a login.
- **Token shape (2026-09-24).** `POST /auth/cli/token` returns the bare JWT (`{"session_id":"windsurf-session-…"}`), not `devin-session-token$…`. The Host resolves `oauth:devin` to the prefixed form (`toDevinSessionToken`, shared with the chat protocol), so code_search and the Devin web-search source send what the Windsurf API expects. Verified live against a real sign-in: both returned results. Settings tests for an unsaved Devin source send the draft, and the Host resolves the draft's key alongside the saved sources (`withDraftSearchSource`).
- **Sign-in sets up the free tools (2026-09-24, owner decision).** On a successful Devin login the Host (`subscription-login-defaults.ts`) turns on code_search with `oauth:devin` unless the user already chose a model or pasted a token, and adds an enabled Devin web-search source unless one exists (a source the user switched off stays off). It never changes `searchRoutePolicy`; when the policy is model-native first, `auth/login-finished.followUp.suggestExternalSearchPriority` lets the client offer a one-click switch, which re-reads the Host config before saving so the new domains are not overwritten. Open settings forms re-sync `web` and `codeSearch` on that event. Doing this on the Host keeps CLI and remote shells consistent.
