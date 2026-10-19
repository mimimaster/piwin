# ADR 0077: GitHub backed piwin extension registry

Status: Accepted (2026-09-28)

## Decision

The community piwin extension market reads `index.json` from the public [piwin-extensions registry](https://github.com/mimimaster/piwin-extensions). Each entry points to a public GitHub repository, an optional subdirectory, and an immutable 40-character commit. The registry stores metadata, not executable code. The Host validates the index, fetches a selected commit, checks the checked-out commit exactly, and stages the source in the managed immutable extension store. It does not run npm install or lifecycle scripts.

The Host owns catalog retrieval and installation; Desktop and CLI only request Host data or use its public application APIs. The curated offline catalog remains available when the community index cannot be fetched. The Host caches a successful community index for five minutes and keeps that snapshot during a temporary fetch failure.

### Amendment (2026-10-18): local-first marketplace loading

`marketplace/catalog-list` accepts `cachedOnly: true` to read the curated offline
catalog plus the Host's last successful extension and Agent index snapshots,
without starting or waiting for network requests. Desktop reads that snapshot
and local inventory first, then requests the complete catalog in the background
and refreshes inventory associations after the indexes arrive. Inventory reads
also use the cached catalog, so browsing installed capabilities and publishing
inventory updates do not depend on registry availability. The existing five-minute
index cache and thirty-second failure retry remain unchanged; snapshots are kept
in Host memory. CLI catalog queries and install-time catalog resolution retain
the existing complete-index behavior.

The first published entry is `mimimaster/commandcode-provider`, an MIT-licensed adaptation of `patlux/pi-commandcode-provider`. Its `piwin/piwin.json` declares `authProvider: "commandcode"`. The Host reads this metadata only from the selected, enabled managed revision. `@piwin/agent-host` loads that exact extension through Pi's resource loader into its separate auth model runtime. The extension's own `registerProvider` registration supplies OAuth and the model catalog; piwin stores credentials under its Host `pi-agent/auth.json`. The OAuth card appears while the extension is enabled; the Models provider is projected after the account connects.

### Amendment (2026-09-28): generic extension subscription providers

The auth bridge is no longer limited to `commandcode`. Any enabled managed extension may claim one subscription provider in `piwin.json`:

```json
{ "authProvider": "acme-cloud", "authProviderName": "Acme Cloud" }
```

- `authProvider` must be a lowercase slug (`[a-z0-9][a-z0-9-]{0,63}`) and must not be a built-in Host subscription id (`V1_SUBSCRIPTION_PROVIDER_IDS` or `anthropic-claude-code`). Invalid or reserved claims are ignored with a Host warning. Two enabled extensions claiming the same id are all refused with a Host warning; unrelated claims continue.
- `authProviderName` is optional. The card name falls back to the `name` the extension passed to Pi `registerProvider`, then to the id.
- The Host auth runtime registers only the claimed id from each extension, so an extension cannot inject side providers into it.
- `auth/status` lists an extension account with `extension: { displayName }`. Shells render such cards from that metadata instead of a built-in copy table and show no quota drawer for them. A stored `oauth` or `api_key` credential under a claimed id counts as signed in, because extensions choose their own credential shape.
- Sessions load the owning extension for every usable extension account, including pure-chat sessions, and flush Pi's pending provider registrations into the session model runtime before model resolution (mirroring Pi `createAgentSessionServices`). The compiler receives the claim snapshot through the subscription compile context; it does not read the extension store itself.
- No piwin source names an extension provider id. `commandcode` and `kiro` are ordinary extension claims.

### Amendment: public no-login model providers

A managed package may instead declare `modelProvider: { id, name?, auth: 'none' }`. This is mutually exclusive with `authProvider` and uses the same reserved-id validation. Its actual `registerProvider` registration supplies the catalog and transport, without an OAuth account or stored credential.

Projected settings/model references use `source: 'extension'`; compiled provider envelopes use `{ kind: 'extension', providerId }`. SDK/RPC skip ordinary channel registration, bind the exact managed revision (including pure chat), and flush the extension registration before model selection. `ResourceInstance.modelProviderId` carries ownership across this boundary. A package directory owns its contained actual entry modules; sibling prefixes and path escapes are not owners. Catalog loading and session flush both reject cross-owner registrations; compiled channel ids cannot be overwritten by extensions.

A collision with a user-owned channel or subscription rejects only the public contribution. Catalog refresh preserves model/provider switches and saved limits, withdraws removed models, and does not automatically select a public model. Explicit references to disabled or removed extension models fail as unavailable. External provider packages may ship independently or be vendored as built-in extensions; provider-specific endpoints and client emulation stay inside the owning extension, not Host services.

## Consequences

- Registry entries are reviewable, reproducible source pins. A branch or tag cannot silently change an installed version.
- Installing stages code without executing it; enabling and applying an extension are separate user actions.
- Enabled provider extensions run with Host user permissions, including when Pi loads them for the OAuth page.
- Uninstalling or disabling a provider extension removes its card and model projection at the next Host status reconciliation. Stored credentials remain in the Host auth file until sign-out.
- The registry can be redirected by the Host's `PIWIN_EXTENSION_REGISTRY_URL` environment variable for a private or self-hosted index.

### Amendment: dynamic public-provider model catalogs (2026-10-19)

Public extensions may use Pi's existing `refreshModels` hook instead of static model registrations. On creation of the enabled public-provider catalog runtime, Host actively refreshes the claimed providers once before model projection. Install/enable catalog publication triggers that initialization; inactive installations remain unexecuted. Concurrent first readers share runtime construction. Provider networking and filtering stay in the independent package.

The existing `models/discover` command routes public-extension rows to their owner runtime and applies the replacement catalog through the settings queue. It never uses the synthetic `extension://` origin as an HTTP endpoint or trusts shell-supplied transport details. Desktop exposes Fetch models and applies this replacement without a BYOK import dialog; manually invented extension models remain unavailable.

For Zen, the owner requires an empty initial list, no model-ID allowlist, and empty publication after any failed/empty live fetch. Its extension persists fetched results through Pi ModelsStore for offline SDK/RPC initialization; a failed live check overwrites that snapshot with an empty catalog. Runtime storage defaults derive from the Host-owned auth path, never from native Pi inventory. Other providers keep their own refresh and persistence policies.

### Amendment: built-in OpenCode Zen (2026-10-19)

OpenCode Zen now ships as a built-in extension under agent-host's existing bundled-extensions tree. Its MIT source and license retain upstream provenance. The shipped package declares a stable `piwin.managedId`, matching the existing marketplace install ID (`piwin-mimimaster-opencode-zen`). The bundled installer stages and selects an immutable revision instead of placing a second flat copy beside a managed installation. A new built-in install defaults to enabled; migration and subsequent upgrades preserve an existing install's enabled/disabled choice. This default activation is specific to shipped built-ins; third-party installation still stages inactive code.

Host prepares bundled extensions before public-provider discovery, including startup before any session or settings page is opened. Selected revisions marked with a Host-generated `bundled:` source locator project `source: bundled` into extension inventory and session resources. Runtime identity remains the exact content revision in both SDK and RPC. Built-in managed revisions are disabled rather than uninstalled and follow application releases; marketplace update prompts do not replace them with an independently published registry version.

Public `modelProvider` claims may include an optional plain-text `notice` (nonempty, at most 4096 characters). Host projects the current manifest name and notice, plus bundled provenance, into provider settings; manifest branding replaces names cached by older versions. Shells render the supplied notice as plain text, preserve it during settings edits, and label built-in providers accordingly. The Zen title is **OpenCode Zen**, with the owner-supplied IP availability guidance replacing the generic extension paragraph. Existing model toggles, limits, defaults and provider enablement are preserved.

The built-in has no static model catalog or fallback model limits. First activation still initiates a live fetch; failed or empty discovery still replaces the visible and stored catalog with zero models. No paid-key mode or automatic public-model selection is added.
