# Evidence: Grok becomes a real installable Agent plugin (2026-10-01)

| Field | Value |
|-------|-------|
| Plan | `docs/plans/2026-10-01-grok-real-agent-plugin.md` |
| ADR | [0082](../adr/0082-grok-build-acp-backend.md) (amendment: executable plugin contract) |
| Scope | Steps 4–6: replace the built-in Host Grok route with the generic plugin bridge, ship a real adapter artifact, verify acceptance |
| Branch state | local, not a published release |

## What this record proves

1. The Host no longer contains a Grok/ACP/xAI implementation.
2. An installed adapter artifact really runs, and the Host drives it through the
   plugin frame protocol only.
3. Media, permissions, workflows, catalog, cancel and lifecycle behave through
   that protocol with a fixture adapter and with the bundled real adapter.

## 1. Host carries no vendor implementation

- `packages/host-runtime/package.json` no longer depends on `@piwin/acp-agent`
  or `@piwin/agent-grok`.
- `grep -rn "@piwin/acp-agent\|@piwin/agent-grok" packages/host-runtime/src apps/*/src` → **0 hits**.
- Deleted Host modules: `grok-backend-service`, `grok-session-handle`,
  `grok-process-transport`, `grok-cli-detection`, `grok-output-context`,
  `grok-generated-media`, `grok-capabilities`, `grok-readiness.test`,
  `grok/agent-plugin-inventory` (re-export shim).
- Host additions (agent-agnostic): `agent-plugin-bridge.ts`,
  `agent-plugin-session.ts`, `agent-plugin-control.ts`,
  `external-agent-backend.ts`, `external-agent-policy.ts`,
  `agent-plugin-media.ts`.
- The vendor MCP wire probe moved to `packages/agent-grok/scripts/` — it is the
  adapter's diagnostic, not the Host's.
- `pnpm test:bundle` now asserts the bundle contains no vendor implementation.
  Forbidden markers, all **0 hits** in `dist-host/host-serve.mjs`:
  `AcpClient`, `JsonRpcConnection`, `GROK_DROPPED_NOTIFICATION_METHODS`,
  `normalizeGrokMediaPresentation`, `projectGrokTurn`, `projectGrokWorkflow`,
  `grok-session-handle`, `createGrokProcessTransport`, `_x.ai/`.
  Remaining `grok` strings are the legacy adapter id, the v1 recipe id kept for
  migration recognition, and piwin's own xAI model ids.

## 2. Product decisions implemented

- **Pi-only commands, agent-agnostic.** `EXTERNAL_AGENT_UNSUPPORTED_COMMANDS`
  maps the 12 Host commands to the capability that gates them and never
  branches on an agent id. An adapter that declares `supported: true` keeps the
  command; an adapter that declares `supported: false` supplies the reason; an
  undeclared adapter gets a Host-owned, agent-agnostic reason.
- **Capabilities come from the adapter.** The Host returns what the adapter
  declared at `session/new`. Before first activation `session/backend-get`
  returns only `agentId` — the Host never fabricates a capability set.
- **Media roots come from the reviewed manifest.** `outputDirectories`
  (`base` + `{backendSessionId}` / `{encodedWorkingDirectory}`) was already in
  the frozen manifest schema, so no protocol change was needed. The Host
  resolves the root, rejects an undeclared directory, a `kind` mismatch, a path
  that escapes the declared root, and an unsafe session id. `@piwin/media`
  remains the only writer into the vault.
- **Workflows go through the adapter** (`session/workflows`,
  `session/workflow-report`) instead of the Host parsing vendor state files.

## 3. Defects found and fixed while verifying

| Defect | Symptom | Fix |
|--------|---------|-----|
| Adapter session never received the Host env | the adapter ran with default settings (`env` was placed inside `ports`, not the open options) | pass `env` on `AgentPluginSession.open` |
| Media imported into the wrong root | a configured Host vault stayed empty; assets landed in the default root | `ExternalAgentBackendDeps.piwinRoot`, wired from the composition root |
| Adapter control process outlived the Host | `piwin agents check` never exited; the adapter child stayed alive | dispose the backend in `disposeHostRuntime` |
| Release during a pending prompt produced an unhandled rejection | full-suite-only failure attributed to `plugin-disposed (in flight: session/prompt)` | release/cancel paths settle a prompt as `aborted`; only a crash rejects |
| `session/prompt` and `session/create` hardcoded `agentId === 'grok'` | any second adapter id was refused as `unknown-agent` | resolve installed adapter ids and per-session capabilities |
| `pnpm test:bundle` fought the running Desktop app for the real root | the smoke inherited `PIWIN_DESKTOP_BUNDLED=1` / `PIWIN_ROOT` | the smoke owns its isolation and strips those variables |

## 4. Tests rewritten to drive a real installed artifact

Integration tests no longer inject a transport. They install a fixture adapter
through the real installer (`installAgentPlugin`, registry source, pinned
manifest digest + artifact digest + byte size) and let the Host launch it:

- `packages/host-runtime/fixtures/agent-plugin-fixture.mjs` — a standalone
  adapter that speaks the frame protocol and spawns no vendor CLI.
- `src/grok/grok-host.integration.test.ts` — 9 cases: unchecked readiness,
  prompt projection, generated media into the vault, permission round trip,
  cancel of a hung prompt (`cancelled`, not `failed`), workflows + report +
  MCP status, catalog sync/rename/delete, capability-refusal wording before and
  after activation, disable blocks Runs and uninstall keeps history.
- `src/grok/agent-plugin-lifecycle.integration.test.ts` — 7 cases: listing and
  unchecked status never start the adapter, disabled adapter is reported without
  launching, uninstall keeps the user-owned CLI, serialized store mutations,
  digest/version pin rejection, unreviewed source refusal, reviewed-id seam.
- `src/agent-plugin-bridge.test.ts` 9, `agent-plugin-session.test.ts` 7,
  `agent-plugin-control.test.ts` 8, `agent-plugin-media.test.ts` 10,
  `agent-plugin-inventory.test.ts` 11 (incl. bundled artifact digest gate).

## 5. Real adapter artifact (bundled, digest-verified)

- `packages/agent-grok/scripts/build-plugin.mjs` now emits
  `dist/manifest.json` (schema 2, `piwin-agent-stdio` v1) describing the exact
  `dist/agent.mjs` digest, byte size, source revision and the two declared
  output directories.
- `installAgentPlugin` installs a `bundled` source from
  `PIWIN_BUNDLED_ASSETS_ROOT/agents/<id>/` with the same digest gate as a
  download; a tampered artifact is refused and leaves no inventory record.
- `scripts/bundle-host.mjs` builds `@piwin/agent-grok` and ships it as
  `dist-host/bundled-assets/agents/grok/`.
- The CLI resolves the install source from the Agent marketplace catalog
  (real artifact) instead of a vendor recipe, and accepts any reviewed agent id
  (`--manifest-url` + `--sha256` + `--version` for out-of-band installs).

## 6. Commands run (2026-10-01)

| Command | Result |
|---------|--------|
| `pnpm typecheck` | all packages `Done`, no `error TS` |
| `pnpm test` (whole repo) | exit code **0** |
| `pnpm --filter @piwin/host-runtime test` | 431 files / 3695 tests passed |
| `pnpm test:architecture` | `Package boundaries OK` |
| `pnpm bundle:host` + `pnpm test:bundle` | passes, includes the new no-vendor-implementation assertion |

### CLI acceptance on a temporary Host (real bundled artifact)

```
PIWIN_ROOT=<tmp> PIWIN_BUNDLED_ASSETS_ROOT=<assets with agents/grok> \
  piwin agents install --agent grok      → install succeeded
  piwin agents list                      → grok  adapter v1.0.0  enabled  runtime: not checked
  piwin agents disable --agent grok      → succeeded
  piwin agents enable  --agent grok      → succeeded
  piwin agents uninstall --agent grok    → succeeded; list → (no agent adapters installed)
  piwin agents check --agent grok --refresh
      → grok  ready — v1.0.46 at ~/.grok/bin/grok (unverified)
        auth: cached_token
      → CLI exits in 2s, no leftover adapter process
```

The `check` line is real: the Host launched the **bundled adapter artifact**
from disk, the adapter detected the locally installed Grok CLI, and the Host
reported the adapter's status. No paid prompt was issued and no Grok session
was created or deleted.

## 6b. CLI and browser on the same temporary Host (2026-10-01, this slice)

A disposable Host listened at `ws://127.0.0.1:8877` with `PIWIN_ROOT` isolated and
`PIWIN_BUNDLED_ASSETS_ROOT/agents/grok` containing the built adapter artifact.
The web shell at `http://127.0.0.1:1439/` connected to that Host.

Browser DOM and screenshots:

- Settings → Agent 后端 showed **安装 Grok 适配插件** before any adapter existed.
- After clicking install, the page showed `Grok Build · 适配插件 v1.0.0 · 已启用`
  and `代码修订 941551c0c63f`. Copy states the CLI is user-owned and that
  installing the adapter does not install the CLI.
- Check again reported `可用`, `v1.0.46 (/Users/yorickjue/.grok/bin/grok) · 未验证`,
  and read-only permission mode `always-approve`.
- Disable showed `已停用`. Uninstall confirm kept history wording; after confirm
  the install button returned.
- Inventory on that root after uninstall: `plugins: []`, artifact directory removed.
- The same root from CLI: `piwin agents list` → `(no agent adapters installed)`.
  While the browser Host held the root lease, a second CLI Host was refused
  (`piwin root is already owned`), so both shells were on one authority.

Screenshots were visually read: before install, after install (revision visible),
 and after check (ready, unverified CLI, permission mode).

Upgrade confirmation is explicit: a different revision is refused until the
operator confirms in Settings or Marketplace, and a session binding moves only
through `agents/confirm-binding-migration` when `assessAgentPluginBinding` says
the revision is compatible. Integration test covers stale refusal, compatible
confirm, preserved native session id, and preserved history.

## 7. Verified vs unverified

**Verified**

- Host vendor-code removal; bundle assertion.
- Adapter artifact install (bundled + registry), digest/tamper/version gates.
- Prompt, events, media import, permission bridge, cancel, workflows, MCP
  status, catalog sync/rename/delete, disable/uninstall, readiness reporting —
  against the fixture adapter and, for readiness, against the real bundled
  adapter.
- CLI install/enable/disable/uninstall/check on a temporary Host.
- Browser install → revision display → check (ready, unverified CLI) → disable
  → uninstall on that same Host. See §6b.
- Explicit revision replacement and compatible session-binding migration.
  Disabled adapter rejects both a new prompt and a queued turn.

**Not verified in this record**

- A paid Grok prompt over the plugin path, and deleting a real Grok-native
  session. The local CLI reports `cached_token` and `always-approve`; a paid
  turn needs owner authorization in the isolated test project. Not run.
- Windows/Linux adapter launch.
- Windows/Linux adapter launch (macOS only here).
- Marketplace publication of the adapter artifact: the catalog entry points at
  the reviewed distribution location; the artifact itself is shipped bundled.

## 8. Follow-ups (not done here)

- `docs/adr/0082` section 9's paid-prompt evidence predates this change and
  needs a re-run over the plugin path.
- Host file names still read `grok-*` although their logic is agent-agnostic
  (`grok-session-router.ts`, `grok-host-commands.ts`, `grok-catalog-sync.ts`,
  `grok-compose.ts`, `grok-workflow-commands.ts`, `grok-transcript-replay.ts`).
  Renaming them is cosmetic and was deliberately deferred to keep the diff
  reviewable.
- `external-agent-backend` control processes are disposed with the Host; a
  long-lived Host with many adapters may want an idle-reap policy.
