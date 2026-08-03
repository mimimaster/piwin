# Spec: Settings, Capability Compilation, and Pi Runtime Refactor

| Field | Value |
|---|---|
| Status | Ready for implementation |
| Date | 2026-08-03 |
| Scope | `contracts`, `agent-resources` (new), `agent-host`, `project`, `skills`, `mcp`, `tools-web`, `process`, `notes`, `flashcards`, `desktop`, `cli`, docs |
| Primary owners | Settings control plane, Agent Host capability boundary, Desktop/CLI product surfaces |
| Related | [`architecture.md`](../architecture.md), [`prd.md`](../prd.md), [`settings-ui-redesign.md`](./settings-ui-redesign.md), [`vision-delegation.md`](./vision-delegation.md), ADR 0002/0003/0005/0008/0010/0011/0012/0014/0019/0020/0021/0024/0026 |
| Trigger | Audit found settings-off resources/tools still entering Pi sessions, inconsistent runtime application, and multiple competing config writers |
| Binding rules | `AGENTS.md`: contracts first, only `agent-host` imports Pi, dual host modes remain real, no cross-layer temporary hacks |

---

## 0. Executive summary

piwin currently has multiple configuration surfaces, but there is no single step that compiles those settings into the exact resources, tools, model routes, and prompt encoding that Pi receives. The effective session configuration is assembled opportunistically inside `sdk-adapter.ts`, `host-runtime.ts`, scanners, tool factories, and UI-specific save paths.

That structure produces several confirmed failures:

1. Project trust is evaluated for permissions but not applied consistently to Pi resource loading.
2. Subagent capability resolution computes custom-tool restrictions but does not enforce them on registered Host tools.
3. Native image turns still receive absolute local paths in prompt text.
4. Disabled resource IDs are normalized differently across scanner, installer, config, and ResourceLoader code.
5. Settings changes do not describe or track whether an existing live Pi session still uses the previous tools/resources.
6. Web, MCP, and Process capabilities may remain in the model-visible tool schema after being disabled.
7. Multiple Desktop panels and App autosave paths overwrite the whole config document and can silently re-enable previously disabled capabilities.

This spec replaces those distributed decisions with one pipeline:

```text
SettingsService + ProjectStore + McpConfigStore
                       |
                       v
             SessionCapabilityResolver
                       |
                       v
            SessionCapabilitySnapshot
                /                 \
               v                   v
       ResourceManifest    ContextManifest    ToolManifest
                \                |                /
                 +---------------+---------------+
                                 v
                         SessionBlueprint
                       |
             +---------+---------+
             |                   |
             v                   v
       PiSdkAdapter         PiRpcAdapter
                               -> piwin SDK worker

PromptInput
    |
    v
PromptPreparation
    |
    v
PreparedPrompt -> selected backend
```

The governing product rule is:

> A safety-related disable is enforced immediately by the Host. Removing a resource or tool from the model-visible Pi schema happens when a new Agent Runtime is created. The UI and CLI must state both facts explicitly.

The refactor intentionally allows deleting old code. It does not preserve obsolete APIs merely to reduce the diff. Compatibility is handled through one-time persisted-data migration and explicit product notices, not by maintaining two runtime interpretations indefinitely.

---

## 1. Purpose

### 1.1 Product purpose

Users must be able to answer all of the following without reading implementation details:

- Is this capability configured?
- Is it available to me manually in Desktop or CLI?
- Is it available to the Agent/model?
- Is it loaded in the current Agent Runtime?
- Is its backing service currently running and healthy?
- If I change it, when does the change take effect?
- What data or configuration remains after I turn it off?

The Settings product must no longer use one ambiguous `Enabled` switch to represent product access, Agent exposure, item trust, and process health at the same time.

### 1.2 Architecture purpose

The Host must have one immutable, testable representation of the exact capability set used to create a live Pi session. Pi adapters must not independently read product settings or reconstruct policy.

The refactor must make the following invariants mechanically testable:

1. An untrusted project cannot contribute executable extensions or model instructions to Pi.
2. A disabled Agent capability is absent from the newly created Pi tool schema.
3. A subagent cannot receive tools or Skills outside its immutable capability ceiling.
4. Native/delegated image prompts do not contain absolute media paths.
5. Desktop and CLI use the same Host decisions and report the same effective state.
6. SDK and RPC modes consume the same compiled session input.
7. A stale Settings write cannot overwrite a newer unrelated setting.

### 1.3 Delivery purpose

The work must be deliverable as vertical, reviewable phases. Each phase must leave the application usable and must remove replaced code once all consumers have migrated.

---

## 2. Goals

1. Introduce one versioned, revisioned Settings control plane.
2. Compile Settings, project trust, MCP inventory, resource/context inventory, subagent ceilings, and session scope into `SessionCapabilitySnapshot`.
3. Compile exact Resource, Context, and Tool manifests before calling Pi.
4. Move image/context preparation into one Host-owned prompt path shared by Desktop and CLI.
5. Track the configuration revision and capability snapshot used by each live Agent Runtime.
6. Provide honest product UX for immediate, next-message, new-runtime, service-restart, and Host-restart changes.
7. Consolidate Settings navigation and clarify capability semantics.
8. Preserve product data while disabling Agent access.
9. Keep SDK and RPC architecture aligned and prepare the real piwin SDK worker path.
10. Delete obsolete config writers, duplicated scanners, ad hoc tool gates, and prompt-routing branches.

---

## 3. Non-goals

1. Full Pi JSONL branch/tree restoration.
2. Lossless hot replacement of an arbitrary live Pi session.
3. An OS-level sandbox for Pi Extensions, MCP, Process, or Bash.
4. Moving or owning Pi upgrades under `~/.pi/agent`.
5. Per-source enable/disable for duplicate resource IDs in the first migration. V2 keeps a documented logical-ID toggle and exposes source precedence/shadowing.
6. A full visual permissions-rule editor.
7. Replacing the existing product transcript format.
8. Introducing another Agent kernel or an Electron runtime.
9. Automatically killing user-started managed processes merely because Agent exposure is turned off.
10. Silent automatic rebuild of long-running conversations after every Settings change.

---

## 4. Locked decisions

| ID | Decision |
|---|---|
| SCR-01 | `SettingsService` is the only writer of `~/.piwin/config.json`. |
| SCR-02 | Runtime capability decisions are compiled in `@piwin/agent-host`, not in apps, adapters, or domain packages. |
| SCR-03 | Pi adapters consume a `SessionBlueprint`; they do not read Settings or project trust. |
| SCR-04 | Safety disable/revocation blocks new execution immediately, including calls from stale live sessions. |
| SCR-05 | Tool/resource schema changes apply to a new Agent Runtime, not through partial hot reload. |
| SCR-06 | The default product action for a stale runtime is `Start new session`; runtime reload is explicit and warns about reconstructed context. |
| SCR-07 | Project-scoped Agent sessions require an explicitly trusted project. Opening a folder does not automatically trust it. |
| SCR-08 | ResourcePolicy still defensively excludes project resources when project trust is absent, even if session creation should already have been rejected. |
| SCR-09 | Resource IDs use one canonical function from `@piwin/contracts`. A logical ID toggle applies to all copies with that ID; the UI shows the effective source and shadowed copies. |
| SCR-10 | Native vision uses Pi `ImageContent` without path text. Successful vision delegation injects description without path. Absolute path text exists only in explicit text-only fallback. |
| SCR-11 | Availability and permission are separate: availability controls whether Pi sees a tool; permission controls a concrete invocation. |
| SCR-12 | Extension disable prevents future loading. In SDK in-process mode, Host restart is required to guarantee cleanup of module-global extension side effects. |
| SCR-13 | `[]` means an exact empty allowlist. `undefined`/`null` is the only representation of no additional ceiling. |
| SCR-14 | Existing user data is preserved during capability disable. Notes, flashcards, media, MCP definitions, resources, and process records are not deleted by an exposure switch. |
| SCR-15 | RPC product parity is achieved through a piwin-owned SDK worker, not stock Pi RPC and not a permanent RPC-to-SDK fallback. |
| SCR-16 | Pi/global/project `AGENTS.md`, `CLAUDE.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md` are represented by an explicit `ContextManifest`; adapters may not rely on invisible default context discovery. |

---

## 5. Product state model

### 5.1 Four independent states

Every configurable capability may expose some or all of these states:

```ts
type ConfiguredState = 'on' | 'off' | 'manual-only' | 'agent';

type EffectiveState =
  | 'available'
  | 'unavailable'
  | 'blocked-untrusted'
  | 'missing-configuration'
  | 'unsupported-host-mode';

type RuntimeLoadState =
  | 'not-applicable'
  | 'loaded'
  | 'not-loaded'
  | 'stale'
  | 'rebuilding';

type ServiceHealthState =
  | 'not-applicable'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'error';
```

These types are conceptual categories. Concrete cross-boundary contracts should use domain-specific unions rather than one overly generic state object where necessary.

### 5.2 Application timing

```ts
export type SettingsApplyTiming =
  | 'immediate'
  | 'next-message'
  | 'new-subagent'
  | 'new-runtime'
  | 'service-restart'
  | 'host-restart';
```

Settings mutation responses must include timing and affected sessions:

```ts
export type SettingsApplyImpact = {
  timing: SettingsApplyTiming;
  affectedDomains: SettingsDomain[];
  affectedSessionIds: string[];
  explanation: string;
  securityTightenedImmediately: boolean;
};
```

### 5.3 UI language requirements

Avoid ambiguous copy:

- Bad: `Enabled`
- Good: `Allow the Agent to search the web`
- Good: `Allow the Agent to use this MCP server`
- Good: `Load and execute this Pi Extension`
- Good: `Show this command in the / menu`
- Good: `Manual use only`

Every save confirmation must answer:

1. What changed?
2. What is blocked or available immediately?
3. Does the current runtime still have the previous schema?
4. What action applies the full change?

---

## 6. Target package architecture

### 6.1 Dependency graph

```text
apps/desktop, apps/cli
        |
        v
@piwin/agent-host public commands/contracts
        |
        +--> @piwin/agent-resources (new, pure inventory; no Pi)
        +--> @piwin/project
        +--> @piwin/mcp
        +--> @piwin/tools-web
        +--> @piwin/process
        +--> @piwin/notes / flashcards / media / session
        |
        v
@piwin/contracts

Only @piwin/agent-host imports @earendil-works/pi-*.
```

### 6.2 New package: `@piwin/agent-resources`

Purpose: one pure filesystem inventory for Skills, Extensions, Prompt Commands, and Pi instruction/context files across Pi and piwin roots.

```text
packages/agent-resources/
  package.json
  tsconfig.json
  src/
    index.ts
    resource-catalog.ts
    resource-discovery.ts
    resource-precedence.ts
    resource-diagnostics.ts
    context-discovery.ts
    resource-catalog.test.ts
```

Allowed dependencies:

- `@piwin/contracts`
- Node filesystem/path APIs

Forbidden:

- Pi packages
- HostRuntime
- Desktop UI
- Settings persistence

### 6.3 Agent Host target layout

```text
packages/agent-host/src/
  settings/
    settings-service.ts
    settings-migration.ts
    settings-revision.ts
    settings-apply-impact.ts

  capabilities/
    session-capability-resolver.ts
    resource-policy-resolver.ts
    context-policy-resolver.ts
    tool-policy-resolver.ts
    session-capability-fingerprint.ts

  sessions/
    session-blueprint-compiler.ts
    session-runtime-controller.ts
    session-runtime-status.ts

  tools/
    tool-registry.ts
    tool-manifest-builder.ts
    host-tool-execution-router.ts
    pi-tool-adapter.ts

  prompt/
    prompt-preparation.ts
    prompt-attachment-validator.ts
    prompt-context-composer.ts
    image-prompt-policy.ts
    image-path-fallback.ts
    pi-image-content-loader.ts

  pi/
    pi-resource-loader.ts
    pi-session-factory.ts
    pi-session-handle.ts
    pi-model-runtime.ts

  adapters/
    sdk-adapter.ts
    rpc-adapter.ts

  rpc/
    worker-client.ts
    worker-entry.ts
    worker-protocol.ts
    worker-tool-proxy.ts
```

The exact move can be incremental, but target ownership is binding. New code must not be added to the current large `sdk-adapter.ts` or `host-runtime.ts` when the target module exists.

---

## 7. Settings document V2

### 7.1 Persisted shape

`~/.piwin/config.json` remains human-readable JSON. It is not wrapped in a second `config` property.

```ts
export type PiwinConfigV2 = {
  schemaVersion: 2;
  hostMode: 'sdk' | 'rpc';
  agentMock?: boolean;

  providers: ModelProviderConfig[];
  defaultProviderId?: string;
  defaultModelId?: string;

  capabilities: CapabilityConfig;

  media: MediaConfig;
  artifact: ArtifactConfig;
  web: WebConfig;
  process: ProcessRuntimeConfig;
  notes: NotesRuntimeConfig;
  flashcards: FlashcardsRuntimeConfig;
  automation: AutomationConfig;
  visionDelegation?: VisionDelegationConfig;
  imageGeneration?: ImageGenerationRuntimeConfig;

  // Existing non-capability domains remain, normalized and validated.
  permissions?: PermissionConfig;
  compaction?: CompactionConfig;
  session?: SessionConfig;
  marketplace?: MarketplaceConfig;
  walkthrough?: WalkthroughConfig;
  subagents?: SubagentConfig;
  remote?: RemoteConfig;
  desktop?: DesktopRestoreConfig;
  thinking?: ThinkingConfig;
};
```

The `revision` is not user-authored and does not need to be persisted as a mutable counter. `SettingsService` computes a stable hash from the normalized document returned by the latest read. `settings/apply` compares `expectedRevision` against the current normalized hash.

### 7.2 Capability configuration

```ts
export type CapabilityExposure = 'off' | 'manual-only' | 'agent';

export type NotesAccess =
  | 'off'
  | 'manual-only'
  | 'agent-read'
  | 'agent-read-write';

export type FlashcardsAccess =
  | 'off'
  | 'manual-review'
  | 'agent-create';

export type ResourceCollectionConfig = {
  extraPaths: string[];
  /** Canonical logical ids. One id disables all discovered copies. */
  disabledIds: string[];
};

export type CapabilityConfig = {
  resources: {
    skills: ResourceCollectionConfig;
    extensions: ResourceCollectionConfig & {
      /** Bundled safety extensions are controlled per item, not by this master. */
      allowThirdParty: boolean;
    };
    prompts: ResourceCollectionConfig;
    piNative: {
      skills: boolean;
      extensions: boolean;
      prompts: boolean;
      instructions: boolean;
    };
    projectInstructions: {
      /** Trusted-project AGENTS.md / CLAUDE.md discovery. */
      agentsFiles: boolean;
      /** Trusted-project .pi/SYSTEM.md / .pi/APPEND_SYSTEM.md discovery. */
      systemPrompts: boolean;
    };
  };
  tools: {
    webSearch: boolean;
    webFetch: boolean;
    mcp: boolean;
    imageGeneration: boolean;
    process: CapabilityExposure;
    browser: CapabilityExposure;
    subagents: CapabilityExposure;
    notes: NotesAccess;
    flashcards: FlashcardsAccess;
  };
};
```

Rules:

- Whether a Host custom tool is registered for the Agent comes only from `capabilities.tools` plus runtime availability and session ceilings.
- Domain runtime configs contain parameters, not duplicate Agent exposure booleans.
- `ProcessConfig.enabled`, `NotesConfig.enabled`, and `FlashcardsConfig.enabled` are removed after migration.
- `imagegen` Skill state no longer controls `image_gen` registration.
- `web.searchSources[].enabled` remains source participation, not the Web Search master switch.
- `mcp.json.mcpServers[id].disabled` remains server-level trust/availability, not the MCP family master switch.

### 7.3 Settings commands

Contracts add:

```ts
export type SettingsSnapshot = {
  revision: string;
  config: PiwinConfigV2;
};

export type SettingsMutation =
  | { kind: 'set-provider-catalog'; providers: ModelProviderConfig[] }
  | { kind: 'set-default-model'; model?: ModelRef }
  | { kind: 'set-tool-exposure'; tool: keyof CapabilityConfig['tools']; value: unknown }
  | { kind: 'set-resource-enabled'; resourceKind: ResourceKind; resourceId: string; enabled: boolean }
  | { kind: 'set-resource-extra-paths'; resourceKind: ResourceKind; paths: string[] }
  | { kind: 'set-pi-native-source'; resourceKind: ResourceKind; enabled: boolean }
  | { kind: 'set-instruction-policy'; policy: CapabilityConfig['resources']['projectInstructions'] }
  | { kind: 'replace-web-config'; web: WebConfig }
  | { kind: 'replace-process-config'; process: ProcessRuntimeConfig }
  | { kind: 'replace-notes-config'; notes: NotesRuntimeConfig }
  | { kind: 'replace-flashcards-config'; flashcards: FlashcardsRuntimeConfig }
  | { kind: 'replace-automation-config'; automation: AutomationConfig }
  | { kind: 'replace-vision-delegation'; visionDelegation?: VisionDelegationConfig }
  | { kind: 'replace-image-generation'; imageGeneration?: ImageGenerationRuntimeConfig }
  | { kind: 'replace-permissions-config'; permissions: PermissionConfig }
  | { kind: 'replace-desktop-restore'; desktop: DesktopRestoreConfig };

export type ApplySettingsInput = {
  expectedRevision: string;
  mutations: SettingsMutation[];
};
```

IPC:

```text
settings/get
settings/apply
```

Stable errors:

```text
settings-revision-conflict
settings-validation-failed
settings-migration-failed
settings-write-failed
```

### 7.4 Persistence requirements

`SettingsService` must:

1. Load and migrate V1 before exposing a `SettingsSnapshot`.
2. Validate the entire normalized document.
3. Preserve unknown top-level fields during the migration window so an older UI domain cannot erase a newer domain.
4. Write to a sibling temporary file.
5. Flush/sync where supported.
6. Atomically rename to `config.json`.
7. Keep one last-good backup.
8. Serialize writes in-process.
9. Use a bounded cross-process lock for Desktop Host and CLI Host writers.
10. Reject stale revisions rather than last-writer-wins.

### 7.5 V1 to V2 migration

| V1 field/state | V2 result |
|---|---|
| Missing schema version | `schemaVersion: 2` |
| `skills` | `capabilities.resources.skills` |
| `extensions` | `capabilities.resources.extensions`, `allowThirdParty: true` for existing installs |
| `prompts` | `capabilities.resources.prompts` |
| Pi native implicit loading | `capabilities.resources.piNative.* = true` for existing installs |
| Trusted-project instruction/context discovery | `projectInstructions.agentsFiles = true`, `projectInstructions.systemPrompts = true` for existing installs |
| `process.enabled === false` | `capabilities.tools.process = 'off'` |
| Process true/absent | `capabilities.tools.process = 'agent'` |
| `notes.enabled === false` | `capabilities.tools.notes = 'off'` |
| Notes true/absent | `capabilities.tools.notes = 'agent-read-write'` |
| `flashcards.enabled === false` | `capabilities.tools.flashcards = 'off'` |
| Flashcards true/absent | `capabilities.tools.flashcards = 'agent-create'` |
| `skills.disabledIds` contains `imagegen` | `capabilities.tools.imageGeneration = false`; remove coupling after migration |
| No `imagegen` disable | `capabilities.tools.imageGeneration = true` |
| Existing Web config | `webSearch = true`, `webFetch = true` to avoid upgrade regression |
| Existing MCP config | `mcp = true`; retain each server `disabled` flag |
| Browser previously always available | `browser = 'agent'` for existing installs |
| Subagents previously available | `subagents = 'agent'` for existing installs |
| Resource IDs | Normalize, deduplicate, sort; empty normalized IDs are rejected with diagnostic |

Migration must be tested from representative real-world fixtures, including partial configs and unknown fields.

---

## 8. Resource identity, inventory, and trust

### 8.1 Resource contracts

```ts
export type ResourceKind = 'skill' | 'extension' | 'prompt';

export type ResourceSource =
  | 'piwin-bundled'
  | 'piwin-user'
  | 'pi-native'
  | 'project'
  | 'mapped';

export type ResourceId = string;

export type ResourceInstance = {
  kind: ResourceKind;
  id: ResourceId;
  name: string;
  source: ResourceSource;
  absolutePath: string;
  executable: boolean;
  diagnostics: ResourceDiagnostic[];
};

export type ResourceActivationState =
  | 'active'
  | 'disabled'
  | 'blocked-untrusted'
  | 'blocked-source'
  | 'shadowed'
  | 'invalid';
```

`normalizeResourceId` belongs to `@piwin/contracts` because IDs cross Settings, inventory, subagent profiles, SDK/RPC blueprints, and UI.

Required behavior:

```ts
normalizeResourceId(' My Review_Skill ') === 'my-review-skill';
```

The function must:

- trim;
- lowercase;
- replace non `[a-z0-9-]` runs with `-`;
- collapse repeated separators;
- trim leading/trailing separators;
- return an error for an empty result.

### 8.2 Inventory roots

The catalog scans:

- `~/.piwin/skills`
- `~/.piwin/extensions`
- `~/.piwin/prompts`
- `~/.pi/agent/skills`
- `~/.pi/agent/extensions`
- `~/.pi/agent/prompts`
- `~/.pi/agent/AGENTS.md` / `CLAUDE.md`
- `~/.pi/agent/SYSTEM.md`
- `~/.pi/agent/APPEND_SYSTEM.md`
- project `.pi/skills`
- project `.agents/skills`
- project `.pi/extensions`
- project `.pi/prompts`
- project/ancestor `AGENTS.md` / `CLAUDE.md`
- project `.pi/SYSTEM.md`
- project `.pi/APPEND_SYSTEM.md`
- configured mapped paths

Bundled resource installation happens during Host bootstrap or explicit ensure/install operations, not as a side effect of every session creation.

### 8.3 Precedence and duplicate IDs

V2 retains one logical ID toggle. If multiple instances have the same ID:

1. Inventory returns all instances.
2. The resolver follows verified Pi 0.80.10 precedence unless superseded by a dedicated ADR.
3. One instance is effective; other instances are `shadowed`.
4. Disabling the logical ID disables all copies.
5. UI copy must say `Disables all copies with this resource ID`.

Per-source toggles are deferred until a stable selector and migration need is proven.

### 8.4 Project trust policy

Product policy:

- A folder can be opened without being trusted.
- An untrusted folder supports non-Agent browsing surfaces only.
- Creating a project-scoped Agent session requires explicit trust.
- Desktop displays a trust decision before the first project Agent session.
- CLI TTY prompts; non-TTY fails unless the project was already trusted or an explicit trust command was run.
- Add `project/untrust` and CLI parity.

Defense-in-depth ResourcePolicy:

```text
general session:
  allow piwin-bundled, piwin-user, pi-native, mapped

trusted project session:
  allow piwin-bundled, piwin-user, pi-native, mapped, project

untrusted project session:
  reject session creation
  and, if reached internally, exclude all project resources/context
```

Project-provided instructions blocked when untrusted:

- `.pi/extensions`
- `.pi/skills`
- `.agents/skills`
- `.pi/prompts`
- `.pi/settings.json`
- `.pi/SYSTEM.md`
- `.pi/APPEND_SYSTEM.md`
- project/ancestor `AGENTS.md` and `CLAUDE.md`

Global Pi resources under `~/.pi/agent` remain user-controlled and may load according to the Pi Native source settings.

For trusted projects, project instructions are still independently configurable:

- `projectInstructions.agentsFiles = false` excludes project/ancestor `AGENTS.md` and `CLAUDE.md` while keeping the project trusted for tools.
- `projectInstructions.systemPrompts = false` excludes project `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md`.
- Pi-native global instructions load only when `piNative.instructions = true`.

This separation is required so “trust project tools” does not silently become “accept every project prompt injection” when the user explicitly disabled project instructions.

### 8.5 ResourcePolicy and manifest

```ts
export type ResourceSelectionPolicy = {
  disabledIds: ResourceId[];
  allowedSources: ResourceSource[];
  allowlistedIds: ResourceId[] | null;
};

export type ResourcePolicy = {
  skills: ResourceSelectionPolicy;
  extensions: ResourceSelectionPolicy;
  prompts: ResourceSelectionPolicy;
};

export type ResourceManifest = {
  skills: ResourceInstance[];
  extensions: ResourceInstance[];
  prompts: ResourceInstance[];
  diagnostics: ResourceDiagnostic[];
};
```

The manifest contains only active instances. Blocked/shadowed entries remain available through the catalog/status API but are not passed to Pi.

### 8.6 ContextPolicy and ContextManifest

Context files are session-creation inputs but are not Skills, Extensions, or Prompt Commands. They have an explicit policy and manifest:

```ts
export type ContextFileKind =
  | 'agents'
  | 'claude'
  | 'system'
  | 'append-system';

export type ContextFileSource = 'pi-native' | 'project';

export type ResolvedContextFile = {
  kind: ContextFileKind;
  source: ContextFileSource;
  absolutePath: string;
};

export type ContextPolicy = {
  allowPiNativeInstructions: boolean;
  allowProjectAgentsFiles: boolean;
  allowProjectSystemPrompts: boolean;
};

export type ContextManifest = {
  agentsFiles: ResolvedContextFile[];
  systemPrompt?: ResolvedContextFile;
  appendSystemPrompt?: ResolvedContextFile;
};
```

Rules:

- Project entries require trusted project scope and the corresponding Settings switch.
- Global Pi entries require the Pi Native instructions switch.
- The resolver records blocked entries and reasons for Settings/doctor diagnostics.
- Apps never read or concatenate instruction files.
- The Host does not append a hidden replacement system prompt when a source is disabled.

### 8.7 Pi ResourceLoader translation

`pi/pi-resource-loader.ts` may:

- instantiate Pi public SettingsManager/DefaultResourceLoader APIs verified for the pinned Pi version;
- set project trust explicitly;
- pass exact additional resource paths from the manifest;
- pass exact context/system inputs from `ContextManifest` using verified public Pi loader overrides/options;
- use overrides only as a defense against Pi-native duplicate discovery;
- filter project context files based on the compiled trust policy;
- call `reload()` before session creation;
- map Pi diagnostics to normalized Host diagnostics.

It may not:

- load piwin Settings;
- query project trust;
- scan directories;
- install bundled files;
- normalize IDs independently;
- decide subagent Skills;
- decide which sources are allowed;
- fall back to implicit project/global context discovery outside `ContextManifest`.

---

## 9. Tool registry and capability policy

### 9.1 Tool families

```ts
export type SessionToolFamily =
  | 'filesystem-read'
  | 'filesystem-write'
  | 'shell'
  | 'web-search'
  | 'web-fetch'
  | 'mcp'
  | 'process'
  | 'browser'
  | 'planning'
  | 'delegate'
  | 'notes-read'
  | 'notes-write'
  | 'flashcards-read'
  | 'flashcards-write'
  | 'image-generation';
```

### 9.2 Tool registration metadata

```ts
export type HostToolRegistration = {
  definition: HostToolDefinition;
  family: SessionToolFamily;
  requiredSubagentCapability?: SubagentCapability;
  availability: () => Promise<ToolAvailability> | ToolAvailability;
};
```

Dynamic MCP tools use the same registration shape after metadata projection.

### 9.3 Tool policy

```ts
export type SessionToolPolicy = {
  enabledFamilies: SessionToolFamily[];
  piBuiltinToolNames: string[];
  customToolNames: string[];
  enabledMcpServerIds: string[];
};
```

Resolution order:

```text
configured capability exposure
  intersect backing service/config availability
  intersect project trust
  intersect host-mode capability
  intersect session mode restrictions
  intersect subagent immutable ceiling
  -> exact ToolManifest
```

### 9.4 Availability versus permission

- Availability determines whether a tool is included in `ToolManifest`.
- Permission evaluates a concrete command/path/URL/selector when an available tool executes.
- Disabled tools are removed from new runtime schemas.
- Runtime gates still re-check current safety state so an old stale runtime cannot continue using a capability after it is disabled.
- Permission modes do not re-enable unavailable tools.

### 9.5 Capability behavior

| Capability | Registration rule | Immediate stale-runtime gate |
|---|---|---|
| Web Search | master on and at least one ready enabled source | Re-read exposure; deny when off |
| Web Fetch | master on and configured provider ready | Re-read exposure; deny when off |
| MCP | master on and at least one enabled server | Reconcile latest config; deny disabled family/server |
| Process | exposure `agent` | Prevent new starts when no longer `agent`; list/stop existing remain available to manual product UI |
| Browser | exposure `agent` and browser backend available | Deny Agent actions when downgraded; manual panel follows manual/off state |
| Notes | `agent-read` or `agent-read-write` | Enforce current read/write level per call |
| Flashcards | `agent-create` | Enforce current write exposure per call |
| Subagents | exposure `agent` | Prevent new model/plan spawn when downgraded |
| Image generation | master on and valid image model available | Deny new generation calls when off |
| Planning | Main session policy; no global Settings master | Per-turn Agent Mode and permission floor still apply |

### 9.6 Subagent immutable ceiling

```ts
export type SubagentCapabilityCeiling = {
  profileId?: string;
  allowedCapabilities: SubagentCapability[];
  allowedSkillIds: ResourceId[];
  workingDirectory: string;
  isolation: SubagentIsolationMode;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};
```

Rules:

- Child creation persists an exact ceiling, not an optional profile reference that can expand later.
- Effective child capabilities are current global availability intersected with the persisted ceiling.
- New global tools never automatically appear in an existing child ceiling.
- Empty capability or Skill arrays mean none.
- Resume/reload restores working directory, model, thinking, capability ceiling, and Skill ceiling.
- Apps/model-facing callers cannot construct the internal ceiling directly.

---

## 10. Session capability snapshot and blueprint

### 10.1 Snapshot contract

```ts
export type CapabilityInputRevisions = {
  settingsRevision: string;
  projectRevision: string;
  mcpRevision: string;
  resourceCatalogRevision: string;
};

export type SessionCapabilitySnapshot = {
  version: 1;
  snapshotId: string;
  inputs: CapabilityInputRevisions;
  scope: SessionScope;
  workingDirectory: string;
  trust:
    | { kind: 'general' }
    | { kind: 'project'; projectPath: string; trusted: true };
  resources: ResourcePolicy;
  resourceManifest: ResourceManifest;
  context: ContextPolicy;
  contextManifest: ContextManifest;
  tools: SessionToolPolicy;
  subagentCeiling?: SubagentCapabilityCeiling;
};
```

The snapshot must be canonicalized, sorted, and fingerprinted. Adapters cannot mutate or expand it.

### 10.2 SessionBlueprint

`SessionBlueprint` is internal to `agent-host` and may include non-public runtime references:

```ts
type SessionBlueprint = {
  sessionId: string;
  capabilitySnapshot: SessionCapabilitySnapshot;
  modelRuntimeConfig: ResolvedModelRuntimeConfig;
  piBuiltinToolNames: string[];
  hostToolRegistrations: HostToolRegistration[];
  resourceManifest: ResourceManifest;
  contextManifest: ContextManifest;
  permissionSnapshot: ResolvedPermissionSnapshot;
};
```

Only `SessionBlueprintCompiler` creates it.

### 10.3 Adapter responsibilities

SDK/RPC adapters may:

- create/drop/resume backend handles;
- translate blueprint resources/tools/models into Pi APIs;
- translate Pi events to `AgentEvent`;
- route abort/steer/follow-up;
- map extension UI requests through the Host seam.

Adapters may not:

- read `config.json`;
- query project trust;
- build Host tool candidates;
- decide Web/MCP/Process availability;
- resolve subagent profile semantics;
- perform product prompt preparation;
- discover or inject context files outside the compiled ContextManifest;
- invent model capabilities.

---

## 11. Prompt preparation

### 11.1 Ownership

`PromptPreparation` is an internal `@piwin/agent-host` service used by all product prompt paths.

Desktop sidecar and CLI must both submit the same `PromptInput` through HostRuntime/session commands. CLI must stop calling a bare SessionHandle in a way that bypasses product preparation.

### 11.2 Prepared prompt

```ts
type PreparedImageRef = {
  absolutePath: string;
  mimeType: string;
  byteSize: number;
};

type PreparedPrompt = {
  text: string;
  images: PreparedImageRef[];
  imageMode: 'none' | 'native' | 'delegated' | 'path-fallback';
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  streamingBehavior?: 'steer' | 'followUp';
};
```

`PreparedPrompt` is internal/wire-level, not an app-facing replacement for `PromptInput`.

### 11.3 Image routing matrix

| Condition | Text | Images passed to Pi |
|---|---|---|
| No media | User/context text only | none |
| Primary supports image | No media absolute paths | native image refs |
| Text-only + valid delegation | Description block without path | none |
| Text-only + explicit/allowed fallback | Path fallback block | none |
| Invalid/traversal/missing file | Stable preparation error | none |

### 11.4 Native path

Native vision must assert:

- prompt text does not contain media absolute paths;
- prompt text does not contain base64;
- image references point under `~/.piwin/media`;
- size/MIME are revalidated before file read;
- adapter loads bytes into Pi `ImageContent` only after preparation selected native mode.

### 11.5 Delegation path

Successful description format:

```text
[attached image - vision description]
attachment: image-1
mime: image/png
model: provider/model

<description>
```

No absolute path is included.

### 11.6 Path fallback

Path fallback remains supported for text-only models when delegation is unavailable or the user explicitly chooses compatibility mode.

Requirements:

- UI/CLI warns that the model cannot directly see pixels.
- It is never added “just in case” to a native vision turn.
- Provider-specific compatibility settings may request fallback, but default is off for vision-capable models.
- Base64 remains forbidden in prompt text.

### 11.7 User-facing routing

Models & Images must show:

- `Native image input`
- `Vision delegation via <model>`
- `Path fallback; model cannot directly see pixels`
- `Image routing invalid; select a vision model or configure delegation`

Vision delegation changes take effect on the next image message. Model input-capability changes require a new runtime because ModelRuntime registration is session-bound.

---

## 12. Product session and live runtime lifecycle

### 12.1 Identity model

```text
Stable product session
  sessionId + index + transcript
        |
        v
Live Agent Runtime generation
  Pi handle + model runtime + resources + tool schema + extensions
```

One product session may have multiple sequential runtime generations. Only one may be active at a time.

### 12.2 Runtime status

```ts
export type SessionRuntimeStatus = {
  sessionId: string;
  state: 'none' | 'lazy-shell' | 'live' | 'stale' | 'rebuilding' | 'failed';
  generationId?: string;
  settingsRevision?: string;
  capabilitySnapshotId?: string;
  staleDomains: SettingsDomain[];
  reconstructionMode?: 'native-live' | 'product-history';
};
```

`session/resume` must stop returning a misleading single `live: boolean` for both real handles and lazy product shells.

### 12.3 Runtime staleness

Changes that mark a runtime stale include:

- provider/model registration changes;
- resource enable/disable/install/path changes;
- project trust changes;
- Agent tool exposure changes;
- MCP direct-tool inventory changes;
- permission rule snapshot changes where the rule design remains session-bound;
- subagent parent tool exposure changes.

Changes that do not require runtime replacement include:

- Desktop appearance;
- Artifact preview preference/max bytes;
- Vision delegation routing parameters;
- media-save limits for future saves;
- automation execution configuration;
- service health changes where the existing tool uses a dynamic Host router.

### 12.4 Immediate safety tightening

When exposure or trust is reduced:

1. Persist the new Settings/project state.
2. Update Host execution gates immediately.
3. Mark affected runtime domains stale.
4. Do not silently abort a running turn unless the user requested immediate stop or the operation is an active security incident.
5. New calls from stale tool schemas must fail with a structured capability-disabled error.

### 12.5 Pending changes UX

Display a persistent bar when the active product session has stale domains:

> Settings are saved, but the current Agent still uses the previous runtime schema.

Actions:

1. `Start new session` - default recommendation and safest behavior.
2. `Apply after current run` - queue a runtime replacement after terminal run state.
3. `Advanced: reload current Agent` - explicit context-reconstruction warning.
4. `Stop and apply now` - only while running, requires confirmation.

### 12.6 Runtime reload command

Contracts-first command:

```ts
type SessionReloadRuntimeCommand = {
  type: 'session/reload-runtime';
  sessionId: string;
  expectedSettingsRevision: string;
  when: 'now' | 'after-current-run';
};
```

Preconditions before this command becomes generally available:

1. Internal Pi/tool session identity uses the stable product session ID.
2. `workingDirectory` and worktree cwd are restored.
3. Persisted subagent ceiling is restored.
4. Transcript recorder is flushed.
5. Pending permissions/extension UI requests are settled.
6. Event subscriptions and correlators are removed.
7. Adapter handle and session-owned cleanup are dropped.
8. Session allowlists follow an explicit preserve/clear policy.
9. New runtime is created from the requested current Settings revision.
10. Product-history context injection happens once.

### 12.7 Reconstruction honesty

Current product history is a bounded text projection, not complete Pi conversation restoration. Runtime reload UI must say:

> The visible conversation and session ID are preserved. The Agent context is rebuilt from product history and may omit older tool details, images, compaction state, or extension state.

Do not claim lossless resume until Pi-native session restoration is implemented.

### 12.8 Extension lifecycle

- Enabling an extension applies to a new runtime.
- Disabling/uninstalling prevents loading into future runtimes.
- In SDK in-process mode, a new runtime does not prove module-global timers/processes were removed.
- UI recommends Host restart after disabling a malfunctioning or untrusted extension.
- The later RPC worker provides a stronger teardown boundary by terminating the process.

---

## 13. Settings information architecture

The target navigation has at most 11 top-level sections.

### 13.1 General

- Language
- Startup/restore behavior
- Shortcuts
- Host support diagnostics (collapsed; not presented as configured capability state)

### 13.2 Appearance

- Typography/density
- Themes
- Pets
- Artifact preview

Artifact behavior:

- Master: `Allow interactive HTML/SVG preview`
- Off: source code only, no Preview button/iframe
- On: source-first, explicit per-fence Preview
- Source-first is a security invariant, not another user toggle
- Flashcard review remains a Knowledge feature and may use a dedicated/native renderer

### 13.3 Permissions & Trust

- Default permission preset
- Current project trust
- Trusted project list
- Revoke trust
- Remembered permissions
- Rule diagnostics/editor entry

Project-open flow:

- `Open without trust`
- `Trust and start Agent`

Trust copy must mention project Skills, Prompts, Extensions, tools, and execution permissions.

### 13.4 Models & Images

Tabs:

- Providers
- Vision & Attachments
- Image Generation

Image Generation receives an explicit Agent exposure switch. It is no longer hidden behind the `imagegen` Skill.

### 13.5 Agent Resources

Tabs:

- Skills
- Extensions
- Prompt Commands
- Instructions
- Pi Native
- Packages/Plugins

Resource entries show logical ID, effective source, all discovered paths, diagnostics, configured state, and current-runtime loaded/pending state.

Instructions shows the exact global/project `AGENTS.md`, `CLAUDE.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md` files selected for a new runtime, including blocked reasons. It exposes the project Agents-files and project System-prompt switches defined in V2.

### 13.6 Tools

Tabs:

- Web
- MCP
- Process
- Browser

Rules:

- Switches represent Agent access/trust, not process health.
- Running/Stopped/Error is a separate status.
- MCP server switch means trusted/allowed; it may still be stopped until first use.
- Process/Browser use Off / Manual only / Agent available.

### 13.7 Knowledge

Notes:

- Off
- Manual only
- Agent read
- Agent read/write

Flashcards:

- Off
- Manual review
- Agent create

Knowledge Center remains the data-management surface. Turning off Agent access must not hide/delete user data.

### 13.8 Plans & Subagents

- Plan execution defaults
- Whether Plans may delegate
- Subagent exposure: Off / Manual / Agent & Plans
- Profiles
- Capability/Skill ceilings
- Parallel/worktree policy

Active subagent controls and runtime roster belong in the session/right panel, not Settings.

### 13.9 Automation

Hierarchy:

```text
Global pause
  AND Cron category enabled
  AND Cron item enabled

Global pause
  AND Hooks category enabled
  AND Hook item enabled
```

The page must not claim background scheduling until a scheduler exists. Current product copy must say automation runs only while the Host is running, and manual-only Cron must be labeled honestly.

### 13.10 Sessions

- Auto-name
- Compaction defaults
- Restore behavior
- Walkthrough/report behavior
- Current Runtime status
- Pending Settings domains
- Runtime reload action

### 13.11 Usage & Diagnostics

- Usage
- Host mode/effective backend
- Pi version
- Config/resource paths
- Browser/Chromium health
- MCP/process diagnostics
- Logs
- Restart Host

---

## 14. CLI parity

CLI must call the same Host commands and Settings mutations. It must not edit JSON independently or implement separate capability logic.

Target commands:

```text
piwin settings show
piwin capability list
piwin capability set web-search on|off
piwin capability set web-fetch on|off
piwin capability set process off|manual|agent
piwin capability set browser off|manual|agent
piwin capability set subagents off|manual|agent
piwin capability set notes off|manual|read|read-write
piwin capability set flashcards off|manual|agent-create

piwin resource list --kind skill|extension|prompt --all-sources
piwin resource enable <kind> <id>
piwin resource disable <kind> <id>

piwin instructions list [--project <path>]
piwin instructions set project-agents on|off
piwin instructions set project-system on|off
piwin instructions set pi-native on|off

piwin project list
piwin project trust <path>
piwin project untrust <path>

piwin mcp enable <id>
piwin mcp disable <id>
piwin mcp status [id]

piwin session runtime-status <session-id>
piwin session reload-runtime <session-id> [--after-run]
```

CLI mutation output must include effect:

```text
saved: extension questionnaire disabled
security: future calls blocked immediately
runtime: current session still has the previous resource schema
effect: new or reloaded Agent Runtime
```

TTY trust behavior:

- Existing trusted project: proceed.
- Untrusted project: prompt.
- Non-TTY untrusted project: fail with actionable trust command.
- `--trust-project` may be provided only as an explicit user action and must persist through the Host project service.

Intentional Desktop-only surfaces:

- Artifact iframe preview
- visual Browser panel
- theme/pet preview
- graphical Settings editors

The underlying configuration and Agent exposure must still match CLI behavior.

---

## 15. SDK and RPC backend architecture

### 15.1 Shared backend interface

```ts
interface PiSessionBackend {
  createSession(blueprint: SessionBlueprint): Promise<BackendSessionHandle>;
  dropSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

### 15.2 SDK mode

`PiSdkAdapter` uses the in-process Pi session factory and Host tool execution router.

### 15.3 RPC mode

Target RPC flow:

```text
Agent Host parent
  owns Settings, permissions, MCP, process, browser, web credentials
        |
        v
piwin SDK worker
  owns Pi/model/extension session and tool proxy definitions
        |
        v
HostToolExecutionRouter in parent
```

The worker receives a serializable projection of `SessionBlueprint`. Tool execution frames route to the parent Host, preserving one permission/MCP/process authority.

### 15.4 Deletion gate

Only after SDK/RPC conformance tests pass:

- remove RPC-to-SDK fallback;
- remove stock `pi --mode rpc` product path;
- remove `PIWIN_RPC_STOCK` and temporary worker switches;
- remove duplicated option forwarding in `create-host.ts`/adapters;
- update capabilities/doctor to report real worker isolation.

---

## 16. Implementation plan

Each phase is a vertical slice. A phase is not complete when only contracts or scaffolding exist.

### Phase 0 - Decision and documentation lock

**Goal:** establish one canonical behavior before code changes.

Create/update:

- `docs/adr/0028-versioned-settings-and-runtime-application.md`
- `docs/adr/0029-resource-inventory-trust-and-activation.md`
- `docs/adr/0030-session-capability-blueprints.md`
- update `docs/adr/0005-artifact-and-media.md`
- update `docs/adr/0008-skills-mcp-pi-wiring.md`
- update `docs/adr/0010-pi-extensions-channel.md`
- update `docs/adr/0011-rpc-sdk-fallback-and-prompts.md`
- update `docs/adr/0012-rpc-worker-isolation.md`
- update `docs/architecture.md`
- update `docs/prd.md`
- update `docs/dev-plan.md`

Acceptance:

- Native/delegated/path image behavior has one documented truth.
- Project trust and project resources have one documented truth.
- Settings application timing has one documented truth.
- RPC end-state is explicit.

### Phase 1 - Contracts and SettingsService

Create/update:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/config.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/index.ts`
- `packages/agent-host/src/settings/settings-service.ts`
- `packages/agent-host/src/settings/settings-migration.ts`
- `packages/agent-host/src/settings/settings-revision.ts`
- `packages/agent-host/src/settings/settings-apply-impact.ts`
- `packages/agent-host/src/settings/*.test.ts`
- migrate Desktop/CLI consumers

Steps:

1. Add V2 types and defaults.
2. Add pure V1-to-V2 migration with fixtures.
3. Add full-document validation.
4. Add normalized revision hashing.
5. Add atomic write and last-good recovery.
6. Add bounded lock handling.
7. Add `settings/get` and `settings/apply`.
8. Migrate App autosave to typed mutations.
9. Migrate each Settings page/panel.
10. Migrate resource toggles to Settings mutations temporarily, before ResourceCatalog phase.
11. Migrate CLI config mutation paths.
12. Remove production calls to `config/set`.
13. Delete `config/set` and direct config writers.

Required tests:

- V1 full/default/partial migration.
- Unknown field preservation.
- Canonical resource ID migration.
- Concurrent unrelated mutations.
- Stale same-domain mutation rejection.
- Write interruption recovery.
- Raw-secret validation remains enforced.
- Desktop App restore update cannot overwrite Web/provider/resource updates.

Commands:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli test
pnpm typecheck
```

Exit:

- One Settings writer.
- No whole-config write from apps.
- Save responses include apply impact.

### Phase 2 - ResourceCatalog and trust

Create:

- `packages/agent-resources/package.json`
- `packages/agent-resources/tsconfig.json`
- `packages/agent-resources/src/*`
- `packages/agent-host/src/capabilities/resource-policy-resolver.ts`
- `packages/agent-host/src/pi/pi-resource-loader.ts`

Update:

- `pnpm-workspace.yaml` only if workspace glob does not already include the package
- `tsconfig.json` project references as required
- `packages/contracts/src/resource.ts`
- `packages/contracts/src/context-manifest.ts`
- `packages/project` trust APIs
- Desktop Agent Resources and Trust pages
- CLI project/resource commands
- architecture docs/package ownership

Steps:

1. Add canonical resource identity contracts.
2. Move/replace Skill scanner logic with shared catalog primitives.
3. Move Extension/Prompt metadata scanning out of `agent-host` into the new package.
4. Include Pi native roots.
5. Add precedence/shadowing diagnostics.
6. Discover global/project instruction and system-prompt candidates.
7. Add ResourcePolicy and ContextPolicy pure resolvers.
8. Enforce project trust before `session/create`/CLI chat.
9. Add `project/untrust`.
10. Translate active resource/context manifests to Pi public ResourceLoader APIs.
11. Disable Pi implicit context discovery outside the compiled ContextManifest.
12. Update list APIs to return catalog + activation states.
13. Update UI/CLI to show source/effective/pending/blocked instruction states.
14. Delete duplicate scanners/path collectors after parity fixtures pass.

Required tests:

- general session excludes project resources;
- untrusted project session is rejected;
- defensive untrusted ResourcePolicy excludes project resources/context;
- trusted project includes project resources;
- Pi native inventory is visible;
- mapped resources remain user-authorized;
- logical ID disable applies to all copies;
- collision/shadowing diagnostics;
- Pi ResourceLoader integration receives only active manifest paths;
- project Extension fixture never executes before trust.
- disabled project Agents files are absent from ContextManifest;
- disabled project SYSTEM/APPEND_SYSTEM files are absent;
- Pi-native instructions switch excludes global instruction files;
- Pi ResourceLoader receives no context path outside ContextManifest.

Exit:

- Settings inventory equals Host activation decisions.
- No untrusted project resource reaches Pi.

### Phase 3 - Capability snapshot and ToolManifest

Create:

- `packages/contracts/src/session-capability.ts`
- `packages/agent-host/src/capabilities/session-capability-resolver.ts`
- `packages/agent-host/src/capabilities/tool-policy-resolver.ts`
- `packages/agent-host/src/capabilities/session-capability-fingerprint.ts`
- `packages/agent-host/src/tools/tool-registry.ts`
- `packages/agent-host/src/tools/tool-manifest-builder.ts`
- `packages/agent-host/src/tools/host-tool-execution-router.ts`
- `packages/agent-host/src/sessions/session-blueprint-compiler.ts`

Steps:

1. Add exact capability/snapshot contracts.
2. Add registrations for every Host custom tool.
3. Resolve family exposure and backing availability.
4. Apply subagent ceiling to built-in and custom tools.
5. Convert readonly behavior to capability policy.
6. Remove Web Search when no source is ready.
7. Remove MCP gateway/direct tools when family/server inventory is empty.
8. Remove Process/Browser/Notes/Flashcards/Image Generation tools according to exposure.
9. Keep runtime execution gates for immediate tightening.
10. Compile exact `SessionBlueprint`.
11. Switch SDK adapter to consume the blueprint.
12. Delete ad hoc Host tool assembly from `sdk-adapter.ts`.

Required tests:

- disabled family is absent from tool names;
- Web Search master/source matrix;
- Web Fetch independent switch;
- MCP master/server matrix;
- Process Off/Manual/Agent matrix;
- Browser Off/Manual/Agent matrix;
- Notes read/write access matrix;
- Flashcard access matrix;
- image-generation master/model availability;
- readonly child;
- network-only child;
- MCP-only child;
- read + network child;
- exact empty allowlist;
- global disable intersects child ceiling;
- new globally added tool does not expand old child ceiling.

Exit:

- Pi receives an exact tool set from one manifest.
- Subagent capability restrictions are enforced end-to-end.

### Phase 4 - PromptPreparation and CLI parity

Create/move:

- `packages/agent-host/src/prompt/*`
- focused tests for prompt routing

Update:

- Host session prompt command path
- CLI chat to use HostRuntime/session commands
- SDK image loader
- Desktop image routing status/copy
- vision spec/ADR tests

Steps:

1. Extract attachment validation.
2. Extract model modality lookup.
3. Implement native/delegated/path policy.
4. Remove native path inventory.
5. Remove delegated description path.
6. Remove adapter capability widening.
7. Route CLI through shared preparation.
8. Add structured media-routing events/status.
9. Add explicit fallback option for compatibility.
10. Delete duplicate old prompt preparation branches.

Required tests:

- native text has no absolute path/base64;
- native images are present;
- delegated text has description and no absolute path;
- fallback text has path and no images;
- text-only never receives ImageContent;
- abort cancels delegation;
- symlink/media-root escape rejected;
- missing/oversized/MIME mismatch rejected;
- Desktop/CLI route matrix parity.

Exit:

- One prompt preparation path for every product client/backend.

### Phase 5 - Runtime status and application flow

Create:

- `packages/contracts/src/session-runtime.ts`
- `packages/agent-host/src/sessions/session-runtime-controller.ts`
- `packages/agent-host/src/sessions/session-runtime-status.ts`
- `session/runtime-status` and `session/reload-runtime` commands

Steps:

1. Track snapshot/revision on live handles.
2. Classify Settings changes into stale domains.
3. Push runtime-status changes to Desktop.
4. Add Pending Changes UI.
5. Initially ship `Start new session` as the primary action.
6. Fix stable internal/product session ID.
7. Fix ProductShell cwd restoration.
8. Restore subagent ceiling on resume.
9. Centralize complete handle cleanup/drop.
10. Implement after-run reload queue.
11. Add explicit advanced reload with reconstruction warning.
12. Replace misleading `live` boolean.

Required tests:

- Settings mutation marks only affected sessions/domains stale;
- active run is not silently aborted;
- immediate gate blocks disabled stale tool;
- new session uses latest snapshot;
- reload preserves product ID/transcript;
- worktree cwd preserved;
- subagent ceiling preserved;
- history injected once;
- cleanup removes adapter handle/subscription/recorder/correlation;
- extension disable recommends Host restart in SDK mode.

Exit:

- Product accurately reports current-runtime state.
- Explicit reload works within documented reconstruction limits.

### Phase 6 - Settings product consolidation

Update:

- `apps/desktop/src/settings/section-registry.ts`
- Settings pages/context/navigation
- locale strings
- deep-link redirects
- related ui-kit controls if needed

Steps:

1. Add new 11-section registry.
2. Merge Models/Vision/Image Generation.
3. Merge Skills/Extensions/Prompts/Pi Native/Plugins.
4. Merge Web/MCP/Process/Browser.
5. Add Knowledge access settings.
6. Merge Plans/Subagent profile settings.
7. Move active subagent operations out of Settings.
8. Fix Automation hierarchy and honest scheduler copy.
9. Add Session Runtime page/status.
10. Remove dead `artifact.htmlUiModeDefault` Desktop behavior or formally deprecate the field.
11. Add effect badges and save notices.
12. Preserve legacy deep-link redirects for one release window.

Required tests:

- navigation count and redirects;
- each exposure control maps to the correct Settings mutation;
- configured/effective/loaded/running states render distinctly;
- MCP switch does not masquerade as Running;
- Notes/Flashcards manual access remains after Agent exposure off;
- Automation global/category/item hierarchy;
- Artifact off prevents Preview iframe path.

Exit:

- Settings semantics match runtime behavior and remain discoverable.

### Phase 7 - Real RPC worker parity

Create/update:

- worker protocol/client/entry/proxy files
- shared `PiSessionBackend`
- SDK/RPC conformance fixtures
- ADR 0011/0012 final state

Steps:

1. Define serializable blueprint projection.
2. Implement worker session creation and normalized events.
3. Implement parent-owned tool execution proxy.
4. Implement abort/steer/follow-up.
5. Implement extension UI proxy.
6. Run conformance suite against SDK and worker.
7. Switch RPC product mode.
8. Delete fallback/stock paths and temporary environment switches.

Required conformance assertions:

- same snapshot ID;
- same resource paths;
- same Pi built-in/custom tool names;
- same prepared prompt text/image mode;
- same normalized event ordering/terminal outcome;
- same permission context;
- same MCP/Web/Process disabled behavior;
- same subagent ceiling.

Exit:

- Dual host modes are real and consume one architecture.

---

## 17. Old code deletion plan

Delete only when the corresponding new path has all production consumers and tests.

| Old code/path | Deletion gate |
|---|---|
| `config/set` whole document | All Desktop/CLI/App writes use `settings/apply`; conflict tests pass |
| Panel-owned independent config snapshots | Shared Settings snapshot/mutations integrated |
| Direct skill/extension/prompt config writes | Resource mutation command integrated |
| Duplicate skill/extension/prompt scanners | ResourceCatalog parity fixtures pass |
| Per-module resource ID sanitizers | All use contracts normalizer; migration complete |
| Scope-only project resource inclusion | ResourcePolicy/trust tests pass |
| Bundled install during session creation | Host bootstrap/explicit install path proven |
| Giant Host tool assembly in `sdk-adapter.ts` | ToolRegistry/Blueprint production path active |
| `customToolNames` computed but unused helpers | Exact ToolManifest tests pass |
| Ad hoc readonly branches | Readonly capability policy tests pass |
| `imagegen` Skill/tool coupling | V2 migration + explicit image-generation switch active |
| Native image path inventory | Native prompt tests assert no path |
| Delegated description path | Delegation tests assert no path |
| Adapter force-image capability | Shared preparation covers all clients |
| CLI-specific image routing | CLI HostRuntime parity tests pass |
| `session/resume.live` boolean | Runtime status contract used by Desktop/CLI |
| Incomplete ProductShell recreation | Runtime controller restores cwd/ceiling/ID and tests pass |
| RPC-to-SDK fallback/stock path | Worker conformance and smoke tests pass |

No dead compatibility function should remain with a TODO to remove later unless it has a dated removal issue and no runtime authority.

---

## 18. Testing strategy

### 18.1 Pure unit tests

- resource ID normalization;
- V1-to-V2 config migration;
- Settings mutation/revision conflict;
- Settings apply-impact classification;
- ResourcePolicy trust/source/disabled/allowlist;
- tool family resolution;
- subagent ceiling intersection;
- prompt image-routing matrix;
- stale-domain classification.

### 18.2 Host integration tests

- Settings atomic persistence/recovery;
- project trust gate;
- Pi ResourceLoader active-manifest fixtures;
- exact registered tool names;
- stale runtime immediate gate;
- runtime rebuild cleanup/history injection;
- MCP direct/gateway behavior;
- process/browser/manual exposure;
- CLI/Desktop shared command path.

### 18.3 Pi fixture tests

Pinned Pi 0.80.10 fixtures must verify:

- SettingsManager project trust behavior;
- ResourceLoader additional paths and overrides;
- context-file filtering;
- exact `tools` allowlist behavior for built-in/custom tools;
- extension load/no-load fixture;
- `prompt(text, { images })` behavior.

### 18.4 Desktop tests

- Settings save conflict/reload;
- trust decision flow;
- Agent Resources source/status rendering;
- exposure controls;
- Pending Changes bar;
- runtime reload confirmation;
- MCP trust vs health display;
- Automation hierarchy;
- Artifact source-first/off behavior;
- image-routing messages.

### 18.5 CLI tests

- trust in TTY/non-TTY;
- resource/capability commands;
- mutation effect output;
- runtime status/reload;
- image-routing parity;
- no independent JSON write.

### 18.6 SDK/RPC conformance

Every capability fixture runs against both backends once the worker ships.

### 18.7 Verification commands

Per touched package:

```bash
pnpm --filter <package> typecheck
pnpm --filter <package> test
```

Phase gates:

```bash
pnpm typecheck
pnpm test
pnpm e2e:host-jsonl
pnpm e2e:desktop
pnpm e2e:smoke
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

---

## 19. Observability and errors

### 19.1 Required Host events/status

- settings revision changed;
- session runtime became stale;
- session runtime rebuilding/rebuilt/failed;
- media route selected;
- project resource blocked by trust;
- tool family unavailable and reason;
- resource diagnostics changed;
- extension disable requires Host restart warning.

### 19.2 Stable error codes

```text
settings-revision-conflict
settings-validation-failed
project-untrusted
capability-disabled
capability-manual-only
resource-blocked-untrusted
resource-id-collision
runtime-stale
runtime-reload-running
runtime-reload-failed
media-routing-invalid
media-path-invalid
mcp-family-disabled
mcp-server-disabled
tool-unavailable
```

User-facing messages must not expose secrets or internal stack traces.

---

## 20. Rollout and rollback

### 20.1 Rollout order

```text
ADR/semantics
  -> SettingsService/config V2
  -> ResourceCatalog/trust
  -> CapabilitySnapshot/ToolManifest
  -> PromptPreparation
  -> Runtime status/reload
  -> Settings IA
  -> RPC worker parity
```

### 20.2 Rollback safety

- Preserve V1 backup during the migration window.
- Never move/delete `~/.pi/agent` resources.
- Never delete Notes, Flashcards, Media, MCP config, Skills, Extensions, or Prompts as part of exposure migration.
- Keep product transcripts/session index backward-readable.
- MCP JSON shape remains compatible; family exposure stays in product config.
- If a phase fails, roll back the new consumer and restore the last-good config, not by maintaining two active runtime interpretations.

### 20.3 Feature flags

Avoid long-lived environment flags. A short internal migration flag is acceptable only during a single development phase and must be removed before phase exit.

---

## 21. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| New trust prompt adds friction | User cannot immediately chat after opening a folder | Explain what trust enables; remember decision; one primary `Trust and start Agent` action |
| Disabling hidden project resources changes previous behavior | Skills/extensions disappear after upgrade | Show blocked resources and trust CTA; this is required security correction |
| New runtime does not preserve full Pi context | Agent may lose tool/compaction details | Default to new session; explicit reload warning; improve native resume separately |
| Immediate stale-runtime gate leaves model seeing a now-disabled tool | Model may attempt it and get error | Structured disabled result plus Pending Changes CTA; schema removed on new runtime |
| Removing native path inventory breaks faulty gateways | Some proxies drop images | Explicit compatibility fallback/retry, not default leakage for every provider |
| Resource ID collisions become visible | Existing user sees unexpected shadowing | Keep current verified precedence; show paths and diagnostics before adding per-source controls |
| Extensions cannot be safely unloaded in-process | Side effects may survive runtime replacement | Recommend Host restart; prioritize worker isolation for stronger teardown |
| Settings V2 migration bugs | Config loss | Pure migration fixtures, backup, atomic write, last-good recovery |
| New package increases graph size | Maintenance cost | Package owns one focused pure concept; update architecture and public exports; no Pi dependency |
| RPC worker scope expands project | Delays core fixes | Keep as P2 after shared blueprint is stable; SDK remains product default |

---

## 22. Acceptance criteria

### 22.1 Architecture

- [ ] Only SettingsService writes product config.
- [ ] Apps never construct effective capabilities.
- [ ] Adapters do not read product Settings or project trust.
- [ ] Session creation consumes one immutable capability snapshot/blueprint.
- [ ] Resource inventory and activation are separate and testable.
- [ ] Tool availability and permission evaluation are separate.
- [ ] SDK and RPC target the same blueprint contract.

### 22.2 Security/correctness

- [ ] Untrusted project Agent session creation is rejected.
- [ ] Project resources/context are defensively absent when trust is missing.
- [ ] Disabled project/Pi-native instruction sources are absent from ContextManifest.
- [ ] Disabled Web/MCP/Process/etc. tools are absent from new runtime schemas.
- [ ] Stale runtime calls are immediately blocked after capability disable.
- [ ] Subagent custom and built-in tools respect the exact ceiling.
- [ ] Native/delegated image prompt text contains no media absolute path.
- [ ] Resource toggles use one canonical ID.
- [ ] No Settings save can revert an unrelated newer save.

### 22.3 Product

- [ ] Every control states manual vs Agent scope.
- [ ] Configured/effective/loaded/running states are distinct.
- [ ] Save feedback states application timing.
- [ ] Current runtime stale state has an actionable CTA.
- [ ] Notes/Flashcards data remains available according to manual access after Agent exposure is off.
- [ ] MCP trust/enable is not confused with Running health.
- [ ] Pi native resources are visible and identified as Pi-managed.
- [ ] Desktop and CLI report the same decisions.
- [ ] Automation copy matches actual scheduler/Host behavior.
- [ ] Artifact remains source-first and truly disableable.

### 22.4 Engineering completion

- [ ] Targeted tests and root typecheck/test pass.
- [ ] Public exports are intentional.
- [ ] Old code listed in the deletion plan is removed at each gate.
- [ ] Architecture/ADR/PRD/dev-plan are synchronized.
- [ ] No new untracked config authority or feature flag remains.

---

## 23. Recommended PR slicing

Keep commits and PRs small by concern while preserving vertical usefulness:

1. **Docs/ADRs:** lock semantics and target architecture.
2. **Contracts + SettingsService:** V2 migration and revisioned writes.
3. **Desktop/CLI Settings migration:** remove whole-config writers.
4. **Resource contracts/package:** catalog and canonical identity.
5. **Trust + ResourcePolicy:** Host enforcement and UI/CLI trust flow.
6. **Tool registry:** exact main-session tool manifests.
7. **Subagent ceiling:** end-to-end tool/Skill restrictions.
8. **PromptPreparation:** shared Desktop/CLI image routing.
9. **Runtime status:** stale domains and Pending Changes UI.
10. **Runtime reload:** only after prerequisites/tests.
11. **Settings IA consolidation:** product navigation/copy.
12. **RPC worker:** conformance and fallback removal.

Do not combine unrelated visual redesign or dependency upgrades with these slices.

---

## 24. Final definition

This program is complete when:

> piwin Settings, project trust, resource/context inventory, MCP inventory, session mode, and subagent ceilings are compiled by the Host into the exact instructions, resources, and tools Pi receives; Desktop and CLI clearly show the configured, effective, loaded, and running states; safety disables take effect immediately; full schema changes apply through a new or explicitly reloaded Agent Runtime; and the replaced distributed config/policy code has been deleted.
