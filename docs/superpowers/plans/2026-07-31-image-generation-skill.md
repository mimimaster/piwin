# Image Generation Skill — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are numbered `Task 1..4` so `scripts/task-brief PLAN_FILE N` extracts each one for subagent dispatch.

## What changed from v1

v1 shipped a minimal `image_gen` host tool with **hardcoded** request paths (`/images/generations` for openai-compatible, `:predict` for gemini) and **no dedicated config UI** — it reused the chat default model (`defaultProviderId` + `defaultModelId`). v2 adds:

1. **Model capability config** — `ModelConfigEntry` gains `capabilities` and per-capability `routes` (custom request path + timeout).
2. **Image-generation default model** — `PiwinConfig.imageGeneration.defaultModel` (a `ModelRef`), independent from the chat default.
3. **Dedicated image generation settings page** — a new Desktop settings section (`image-generation`) with the screenshot-style layout: provider/model picker, custom request path, timeout, API key, model ID, model notes/description.
4. **Config-driven routing** — `callImageEndpoint` reads `model.routes.imageGeneration.path` and `timeoutMs` from config instead of hardcoding paths.

### What's already done (v1, commits `901429c`–`371e52d` on `feat/image-generation-skill`)

| Task | Status | Notes |
|------|--------|-------|
| Task 1: `hidden` flag on skills | ✅ Done | `SkillSummary.hidden`, scanner parsing, tests |
| Task 2: Hide hidden skills from UI/CLI | ✅ Done | SkillsPanel filter, CLI filter, tests |
| Task 3: `image_gen` host tool | ⚠️ Needs refactor | Hardcoded paths → config-driven; `resolveImageProvider` → prefer image-gen default model |
| Task 4: Wire `image_gen` into Pi sessions | ⚠️ Minor update | Read `config.imageGeneration` instead of only chat defaults |
| Task 5: Bundled `imagegen` skill | ✅ Done | `skills/imagegen/SKILL.md` |
| Task 6: Docs (ADR, architecture) | ⚠️ Needs update | ADR 0021 must reflect config-driven routing + new settings page |

### What needs to be rolled back / refactored

1. **`packages/agent-host/src/image-gen-tool.ts`** — `callImageEndpoint` hardcoded paths (`/images/generations`, `:predict`) must be replaced with config-driven route resolution. `resolveImageProvider` must prefer `config.imageGeneration?.defaultModel` before falling back to chat defaults.
2. **`packages/agent-host/src/image-gen-tool.test.ts`** — tests must be updated to pass `routes` in model entries and assert config-driven paths.
3. **`packages/agent-host/src/sdk-adapter.ts`** — `buildImageGenTool` call must pass the updated config shape (no structural change, but the config now carries `imageGeneration`).

No full rollback needed — the existing tool structure (router → HTTP → media save → permission gate) is sound. We're extending it with config-driven routes and a dedicated default model.

---

**Goal:** Add a first-class, feature-gated, hidden-from-UI piwin **image generation skill** (`imagegen`) with a **dedicated settings page** for configuring image generation models. The skill guides the agent to a host tool `image_gen`, which routes by **model name** to the correct configured provider/endpoint using **config-driven request paths and timeouts**, saves the generated image through `@piwin/media` (path-based, no base64 in context), and returns an absolute path.

**Architecture:** Contracts-first. Three layers:

1. **Contracts** — `ModelConfigEntry` gains `capabilities?: ModelCapability[]` and `routes?: Partial<Record<ModelCapability, ModelRouteConfig>>`. `PiwinConfig` gains `imageGeneration?: { defaultModel?: ModelRef }`. These are additive optional fields — existing chat model config is untouched.
2. **Host tool** — `image-gen-tool.ts` resolves the image model by: (a) explicit `model` arg → scan all providers for matching model id with `image-generation` capability, (b) `config.imageGeneration.defaultModel` → resolve via `ModelRef`, (c) fall back to chat `defaultProviderId` + `defaultModelId` (backward compat). `callImageEndpoint` reads `model.routes?.imageGeneration?.path` (falls back to protocol defaults) and `timeoutMs`.
3. **Desktop settings** — new `image-generation` settings section with screenshot-style layout: provider dropdown, API endpoint, custom request path, timeout, API key, model ID + discover, model notes, model description. Saves to `config.providers[].models[]` with `capabilities: ['image-generation']` and `routes.imageGeneration`.

**Tech Stack:** TypeScript (strict, NodeNext, ESM), vitest, pnpm workspace, `typebox` (already in `@piwin/agent-host`), Pi 0.80.10 `@earendil-works/pi-coding-agent`.

**ADR:** `docs/adr/0021-image-generation-skill.md` (update existing)

## Global Constraints

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — never weaken without ADR.
- ESM only; relative imports use `.js` extensions (NodeNext).
- No `any`; prefer `unknown` + narrowing. No non-null assertion `!` except after runtime check in same block.
- No silent `catch {}` — AGENTS.md §3.3: log at boundary with context, or rethrow.
- Colocated tests: `foo.ts` + `foo.test.ts` in same `src/` dir.
- `pnpm typecheck` and `pnpm test` must stay green after every task.
- Keep diffs minimal — do not refactor unrelated code.
- **No base64 in model context** (AGENTS.md §3.6): generated images are saved to `~/.piwin/media/<session>/` and injected as **absolute paths** only.
- **Secrets never logged** (AGENTS.md §3.6): resolve API keys via the existing `secret-resolver`; never include keys in tool output, error messages, or logs.
- Media writes go through `@piwin/media` `saveMediaAsset` (media-root + realpath validation, ADR 0019).
- `exactOptionalPropertyTypes` is on: never assign `undefined` to optional fields — use conditional spread in builders.
- **No new MCP**: imagegen must not be exposed as or depend on an MCP server.
- **Config-driven routing**: request paths and timeouts are read from `ModelConfigEntry.routes.imageGeneration`, with protocol-specific defaults as fallback. No hardcoded paths in the tool.
- **Image-gen default model is independent from chat default**: `config.imageGeneration.defaultModel` (a `ModelRef`) is preferred over `config.defaultProviderId` + `config.defaultModelId`. Chat defaults are only a last-resort fallback for backward compat.
- The `image_gen` tool is registered **only when `imagegen` is not in `config.skills.disabledIds`**.
- Hidden skills (frontmatter `hidden: true`) are excluded from the Desktop Skills panel and CLI skill lists, but **still loadable by Pi** when enabled.
- Image generation is a paid/network capability: the outbound HTTP call requires permission (default `ask`).
- `@piwin/agent-host` already depends on `@earendil-works/pi-coding-agent` and `typebox`; the tool uses global `fetch` (Node ≥20) — **no new dependencies**.
- Image **editing** is a documented follow-up and is **not** wired in this plan.
- The new settings page must follow the existing `settings/pages/*` pattern: registered via `section-registry.ts`, reads `useSettings()` context, saves through `saveConfig`.
- **Working-tree hygiene (subagent-driven execution):** the branch working tree carries unrelated, uncommitted user changes (artifact code-first work in `apps/desktop/src/*` and `packages/artifact/*`, plus a `tool-presentation.ts` fix). Implementer subagents must **stage only the files named in their task** — never `git add -A`, `git add .`, or `git commit -am`. The `pnpm typecheck`/`pnpm test` baseline is already green with these changes present; do not "fix" failures in unrelated files.
- **i18n is one file:** Desktop copy lives in `apps/desktop/src/desktop-locale.ts` (a single `DesktopTranslator` type + `getDesktopTranslator(locale)` returning both zh-CN and en). There is no `apps/desktop/src/locales/*` directory. Adding a settings section also requires adding its `labelKey` to `DesktopTranslator['settings']['nav']` (the `SettingsSectionMeta.labelKey` type is `keyof nav`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/contracts/src/config.ts` | add `ModelCapability`, `ModelRouteConfig`, `ModelConfigEntry.capabilities`, `ModelConfigEntry.routes`, `PiwinConfig.imageGeneration` | Modify (Task 1) |
| `packages/contracts/src/config.test.ts` | compile-time type gate for new fields | Create (Task 1) |
| `packages/agent-host/src/image-gen-tool.ts` | refactor `resolveImageProvider` (prefer image-gen default) + `callImageEndpoint` (config-driven routes) | Modify (Task 2) |
| `packages/agent-host/src/image-gen-tool.test.ts` | update tests for config-driven routes + image-gen default model | Modify (Task 2) |
| `packages/agent-host/src/sdk-adapter.ts` | pass updated config to `buildImageGenTool` (no structural change) | Verify (Task 2) |
| `apps/desktop/src/settings/section-registry.ts` | add `image-generation` section id | Modify (Task 3) |
| `apps/desktop/src/settings/pages/image-generation-page.tsx` | new settings page: screenshot-style image model config | Create (Task 3) |
| `apps/desktop/src/settings/pages/index.ts` | register `ImageGenerationPage` | Modify (Task 3) |
| `apps/desktop/src/ImageGenerationSettings.tsx` | main config component (provider picker, route, timeout, model, key) | Create (Task 3) |
| `apps/desktop/src/ImageGenerationSettings.test.tsx` | render + config save test | Create (Task 3) |
| `apps/desktop/src/desktop-locale.ts` | add `nav.imageGeneration` + image-gen copy (single-file i18n; no `locales/*` dir) | Modify (Task 3) |
| `skills/imagegen/SKILL.md` | update guidance to mention config-driven routes | Verify (Task 4) |
| `docs/adr/0021-image-generation-skill.md` | update ADR for config-driven routing + settings page | Modify (Task 4) |
| `docs/architecture.md` | update package map + config notes | Modify (Task 4) |

---

## Task 1: Contracts — model capability + route config + image-gen default

**Why:** The image generation tool needs to read custom request paths and timeouts from config (not hardcode them), and it needs a default model that's independent from the chat default. This is a contracts-first additive change — existing chat model config is untouched.

**Files:**
- Modify: `packages/contracts/src/config.ts:17-30` (`ModelConfigEntry`)
- Modify: `packages/contracts/src/config.ts:133-170` (`PiwinConfig`)
- Create: `packages/contracts/src/config.test.ts` (compile-time type gate)

**Interfaces:**

New types in `config.ts`:

```ts
/** Model capability tags. Drives tool routing and settings UI grouping. */
export type ModelCapability = 'chat' | 'image-generation';

/** Per-capability route override (request path + timeout). */
export type ModelRouteConfig = {
  /** Custom request path appended to provider baseUrl (e.g. '/images/generations'). */
  path?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
};
```

Extended `ModelConfigEntry`:

```ts
export type ModelConfigEntry = {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  tooltipMarkdown?: string;
  /** Capabilities this model supports. Omit = ['chat'] for backward compat. */
  capabilities?: ModelCapability[];
  /** Per-capability route overrides (path, timeout). */
  routes?: Partial<Record<ModelCapability, ModelRouteConfig>>;
};
```

Extended `PiwinConfig`:

```ts
export type ImageGenerationConfig = {
  /** Default model for image generation (independent from chat default). */
  defaultModel?: ModelRef;
};

export type PiwinConfig = {
  // ... existing fields ...
  /** Image generation config (default model, future options). */
  imageGeneration?: ImageGenerationConfig;
};
```

`ModelRef` already exists in `host.ts` — it's `{ protocol, providerId, modelId }`.

- [ ] **Step 1: Write the failing compile-time gate**

Create `packages/contracts/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry, ModelCapability, ModelRouteConfig, PiwinConfig, ImageGenerationConfig } from './config.js';

describe('ModelConfigEntry capabilities + routes', () => {
  it('accepts capabilities and routes', () => {
    const entry: ModelConfigEntry = {
      id: 'glm-image',
      label: 'GLM-图像生成',
      capabilities: ['image-generation'],
      routes: {
        'image-generation': {
          path: '/images/generations',
          timeoutMs: 300_000,
        },
      },
    };
    expect(entry.capabilities).toContain('image-generation');
    expect(entry.routes?.['image-generation']?.path).toBe('/images/generations');
  });

  it('accepts a chat-only model without capabilities (backward compat)', () => {
    const entry: ModelConfigEntry = { id: 'gpt-4.1' };
    expect(entry.capabilities).toBeUndefined();
  });
});

describe('PiwinConfig.imageGeneration', () => {
  it('accepts an imageGeneration default model', () => {
    const config: PiwinConfig = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 0, allowedMimeTypes: [] },
      artifact: { maxBytes: 0, htmlUiModeDefault: false },
      imageGeneration: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'zhipu',
          modelId: 'glm-image',
        },
      },
    };
    expect(config.imageGeneration?.defaultModel?.modelId).toBe('glm-image');
  });
});
```

Run: `pnpm --filter @piwin/contracts typecheck`
Expected: FAIL — `ModelCapability`, `ModelRouteConfig`, `ImageGenerationConfig` don't exist; `capabilities`/`routes` not on `ModelConfigEntry`; `imageGeneration` not on `PiwinConfig`.

- [ ] **Step 2: Add the types**

Edit `packages/contracts/src/config.ts`:

1. Add `ModelCapability` and `ModelRouteConfig` types before `ModelConfigEntry`.
2. Add `capabilities?: ModelCapability[]` and `routes?: Partial<Record<ModelCapability, ModelRouteConfig>>` to `ModelConfigEntry`.
3. Add `ImageGenerationConfig` type (after `PiwinConfig` or near it).
4. Add `imageGeneration?: ImageGenerationConfig` to `PiwinConfig`.

- [ ] **Step 3: Export the new types**

Ensure `packages/contracts/src/index.ts` re-exports `ModelCapability`, `ModelRouteConfig`, `ImageGenerationConfig` (check if config types are already bulk-exported; if so, no change needed).

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm --filter @piwin/contracts typecheck`
Expected: PASS.

Run: `pnpm --filter @piwin/contracts test config`
Expected: PASS.

- [ ] **Step 5: Verify no downstream breakage**

Run: `pnpm typecheck`
Expected: PASS (additive optional fields — no implementer breaks).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/config.ts packages/contracts/src/config.test.ts
git commit -m "feat(contracts): add model capabilities, route config, and imageGeneration default"
```

---

## Task 2: Refactor `image_gen` host tool for config-driven routing

**Why:** The existing `callImageEndpoint` hardcodes `/images/generations` (openai) and `:predict` (gemini). The existing `resolveImageProvider` falls back to chat defaults. Both must be updated to read from the new config fields, with protocol defaults as fallback.

**Files:**
- Modify: `packages/agent-host/src/image-gen-tool.ts`
- Modify: `packages/agent-host/src/image-gen-tool.test.ts`
- Verify: `packages/agent-host/src/sdk-adapter.ts` (no structural change, just passes updated config)

**Key changes:**

### B.1 `resolveImageProvider` — prefer image-gen default

New resolution order:
1. Explicit `modelId` arg → scan all providers for a model with that id (prefer models with `image-generation` capability, but accept any match for backward compat).
2. `config.imageGeneration?.defaultModel` → resolve via `ModelRef` (`protocol` + `providerId` + `modelId`).
3. Fall back to `config.defaultProviderId` + `config.defaultModelId` (chat default — backward compat).
4. If none: throw `ImageGenConfigError`.

```ts
export function resolveImageProvider(
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId' | 'imageGeneration'>,
  modelId?: string,
): ResolvedImageProvider {
  const providers = config.providers ?? [];
  const requested = modelId?.trim();

  // 1. Explicit model name
  if (requested) {
    for (const provider of providers) {
      const match = (provider.models ?? []).find((m) => m.id === requested);
      if (match) return { provider, model: match };
    }
    throw new ImageGenConfigError(
      `image_gen: no configured provider exposes image model "${requested}". Add it under Settings → Image Generation.`,
    );
  }

  // 2. Image-generation default model
  const imageGenDefault = config.imageGeneration?.defaultModel;
  if (imageGenDefault) {
    const provider = providers.find((p) => p.id === imageGenDefault.providerId);
    const model = provider?.models?.find((m) => m.id === imageGenDefault.modelId);
    if (provider && model) {
      return { provider, model };
    }
    // Fall through to chat default if image-gen default is misconfigured.
  }

  // 3. Chat default (backward compat)
  const defaultProvider = providers.find((p) => p.id === config.defaultProviderId);
  const defaultModel = defaultProvider?.models?.find((m) => m.id === config.defaultModelId);
  if (defaultProvider && defaultModel) {
    return { provider: defaultProvider, model: defaultModel };
  }

  throw new ImageGenConfigError(
    'image_gen: no image model configured. Set a default image model under Settings → Image Generation.',
  );
}
```

### B.2 `callImageEndpoint` — config-driven route

Read `model.routes?.['image-generation']?.path` and `timeoutMs`. Fall back to protocol defaults:

| Protocol | Default path | Default timeout |
|----------|-------------|-----------------|
| `openai-compatible` | `/images/generations` | 120_000 ms |
| `google-gemini` | `/models/{modelId}:predict` | 120_000 ms |
| `anthropic-compatible` | (unsupported — throw) | — |

```ts
const DEFAULT_IMAGE_TIMEOUT_MS = 120_000;

function resolveImagePath(provider: ModelProviderConfig, model: { id: string; routes?: Partial<Record<ModelCapability, ModelRouteConfig>> }): string {
  const route = model.routes?.['image-generation'];
  if (route?.path) {
    const base = provider.baseUrl.replace(/\/+$/, '');
    return `${base}${route.path}`;
  }
  // Protocol defaults
  if (provider.protocol === 'openai-compatible') {
    return `${provider.baseUrl.replace(/\/+$/, '')}/images/generations`;
  }
  if (provider.protocol === 'google-gemini') {
    return `${provider.baseUrl.replace(/\/+$/, '')}/models/${model.id}:predict`;
  }
  throw new ImageGenConfigError(
    `image_gen: protocol "${provider.protocol}" does not support image generation.`,
  );
}

function resolveImageTimeout(model: { routes?: Partial<Record<ModelCapability, ModelRouteConfig>> }): number {
  return model.routes?.['image-generation']?.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
}
```

**Custom path validation:** `route.path` is appended to `provider.baseUrl` (trailing slash stripped). A custom path should be a **relative path suffix** starting with `/` (e.g. `/images/generations`). If it lacks a leading `/`, add one; if it looks like an absolute URL (`/^https?:\/\//i`), throw `ImageGenConfigError` — the route is a path, not a host override. The Desktop page should normalize input to a leading-slash path before saving.

The `callImageEndpoint` signature changes to accept the full `ModelConfigEntry` (with `routes`) instead of just `{ id: string }`:

```ts
export async function callImageEndpoint(
  provider: ModelProviderConfig,
  model: ModelConfigEntry,
  args: { prompt: string; editPath?: string; size?: string; quality?: string; n?: number },
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array>
```

The timeout is applied via `AbortSignal.timeout()` merged with the caller's signal (if any). Use `AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])` when the caller passes a signal, else `AbortSignal.timeout(timeoutMs)` (Node ≥20.3; the repo targets Node ≥20). The request path is resolved via `resolveImagePath`.

### B.3 `buildImageGenTool` — pass updated config

`resolveImageProvider` now reads `config.imageGeneration` — the `ImageGenToolOptions.config` field already carries the full `PiwinConfig`, so no options shape change is needed. The `buildImageGenTool` null-check (`try { resolveImageProvider(config) } catch { return null }`) still works — it returns `null` when no image model is resolvable.

- [ ] **Step 1: Update the failing tests**

Update `packages/agent-host/src/image-gen-tool.test.ts`:

1. Add `capabilities` and `routes` to test model entries.
2. Add a test case: `callImageEndpoint` with `routes.imageGeneration.path = '/custom/path'` → fetch called with custom path.
3. Add a test case: `resolveImageProvider` with `config.imageGeneration.defaultModel` → resolves to the image-gen default, not the chat default.
4. Add a test case: `resolveImageProvider` with no image-gen default, falls back to chat default (backward compat).
5. Existing tests (openai `/images/generations`, gemini `:predict`, anthropic unsupported) still pass — they exercise the fallback paths.

- [ ] **Step 2: Implement the refactored `resolveImageProvider`**

Update `packages/agent-host/src/image-gen-tool.ts` with the new resolution order (B.1 above).

- [ ] **Step 3: Implement config-driven `callImageEndpoint`**

Add `resolveImagePath` and `resolveImageTimeout` helpers. Update `callImageEndpoint` to use them. Change the `model` parameter type from `{ id: string }` to `ModelConfigEntry`. Apply timeout via `AbortSignal.timeout()` merged with caller signal.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @piwin/agent-host test image-gen-tool`
Expected: PASS (all updated tests green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @piwin/agent-host typecheck`
Expected: PASS (no new errors besides pre-existing `tool-presentation.ts`).

- [ ] **Step 6: Verify sdk-adapter still compiles**

Run: `pnpm --filter @piwin/agent-host typecheck`
Expected: PASS. `sdk-adapter.ts` passes `config` (full `PiwinConfig`) to `buildImageGenTool` — no change needed.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-host/src/image-gen-tool.ts packages/agent-host/src/image-gen-tool.test.ts
git commit -m "refactor(agent-host): config-driven image_gen routing with capability + route config"
```

---

## Task 3: Desktop image generation settings page

**Why:** Users need a dedicated UI to configure image generation models — provider, API endpoint, custom request path, timeout, API key, model ID, model notes, and model description. This matches the screenshot layout and keeps image-gen config separate from chat model config while sharing the same `config.providers` data store.

**Files:**
- Modify: `apps/desktop/src/settings/section-registry.ts` — add `'image-generation'` to `SettingsSectionId` and `SETTINGS_SECTIONS`
- Create: `apps/desktop/src/settings/pages/image-generation-page.tsx`
- Modify: `apps/desktop/src/settings/pages/index.ts` — register `ImageGenerationPage`
- Create: `apps/desktop/src/ImageGenerationSettings.tsx` — main config component
- Create: `apps/desktop/src/ImageGenerationSettings.test.tsx` — render + save test
- Modify: `apps/desktop/src/desktop-locale.ts` — `nav.imageGeneration` + image-gen page copy (single-file i18n; no `locales/*` dir)

**UI layout (matching screenshot):**

```
┌─────────────────────────────────────────────┐
│ Settings → Image Generation                  │
├─────────────────────────────────────────────┤
│                                              │
│  接口通道            API 接口地址             │
│  [智谱 / GLM ▾]      [https://...]           │
│                                              │
│  自定义请求路径       模型超时时间             │
│  [/images/generations] [300] 秒              │
│                                              │
│  API Key                                     │
│  [••••••••] [⚙]                             │
│                                              │
│  模型 ID                                     │
│  [glm-image] [获取模型]                      │
│                                              │
│  模型备注                                    │
│  [GLM-图像生成]                              │
│                                              │
│  模型介绍                                    │
│  [textarea...]                               │
│                                              │
│  [设为默认图片模型]                          │
│                                              │
└─────────────────────────────────────────────┘
```

**Design decisions:**

1. **Provider reuse**: The page lists providers from `config.providers` (same data store as chat models). Selecting a provider shows its connection info (baseUrl, API key — read-only here, editable in Models page). The image-gen-specific fields (request path, timeout, model ID, notes) are per-model, stored in `provider.models[].routes['image-generation']` and `provider.models[].label` / `tooltipMarkdown`.

2. **Model filtering**: Only models with `capabilities: ['image-generation']` (or no capabilities — backward compat) are shown in the image-gen page. A model can have both `chat` and `image-generation` capabilities.

3. **Adding an image model**: User selects a provider → enters model ID → clicks "获取模型" (discover) or types manually → the model is added to `provider.models` with `capabilities: ['image-generation']` and `routes.imageGeneration = { path, timeoutMs }`.

4. **Default image model**: "设为默认图片模型" button sets `config.imageGeneration.defaultModel = { protocol, providerId, modelId }`.

5. **API key**: Read-only display (shows `••••••••` if keychain ref exists, or env var name). Editing is done in the existing Models page — this page only shows the status. This avoids duplicating key management.

6. **Auto-save**: Same debounced auto-save pattern as `ProviderSettings` — drafts on field change, saves to `config.providers` via `saveConfig`.

**Section registry change:**

```ts
// section-registry.ts
export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'permissions'
  | 'models'
  | 'image-generation'  // NEW
  | 'skills'
  // ... rest unchanged

// Add to SETTINGS_SECTIONS, in the 'agent' group, after 'models':
{ id: 'image-generation', group: 'agent', labelKey: 'imageGeneration' },
```

**Page component:**

`image-generation-page.tsx` follows the `models-page.tsx` pattern — reads `useSettings()`, renders `ImageGenerationSettings`.

`ImageGenerationSettings.tsx`:
- Reads `config` from `useSettings()`
- Lists providers in a dropdown (only providers that have at least one image-generation model, or all providers if none have one yet)
- For the selected provider, shows:
  - API endpoint (read-only `provider.baseUrl`)
  - API key status (read-only — keychain ref or env var)
  - Image generation models list (filtered by `capabilities` includes `image-generation`)
  - Add image model form: model ID, custom request path, timeout (seconds), label, description
  - Per-model: edit route path, timeout, label, description; set as default; remove
- Auto-saves to `config.providers[].models[]` via `saveConfig`

- [ ] **Step 1: Add the section to the registry**

Edit `apps/desktop/src/settings/section-registry.ts`:
- Add `'image-generation'` to `SettingsSectionId`
- Add `{ id: 'image-generation', group: 'agent', labelKey: 'imageGeneration' }` to `SETTINGS_SECTIONS` (after `models`)

- [ ] **Step 2: Add i18n strings**

Edit `apps/desktop/src/desktop-locale.ts` (single-file i18n — there is no `locales/*` dir):
- Add `imageGeneration: string` to `DesktopTranslator['settings']['nav']` (required: `SettingsSectionMeta.labelKey` is typed `keyof DesktopTranslator['settings']['nav']`, so the section won't typecheck without it), and return it from `getDesktopTranslator` in both `zh-CN` and `en` (e.g. 图像生成 / Image Generation).
- Add an `imageGeneration` sub-object under `settings` in `DesktopTranslator` for page copy: page title, provider, API endpoint, custom request path, timeout, API key, model ID, discover models, model label, model description, set as default, add model, remove model, no models configured. Provide both locales.
- Add a `settings.nav.imageGeneration` label so the new nav item renders.

- [ ] **Step 3: Write the failing test**

Create `apps/desktop/src/ImageGenerationSettings.test.tsx`:
- Render with a config that has one provider with one image-generation model
- Assert: provider dropdown shows the provider, model row shows the model ID, custom request path is visible
- Assert: saving updates `config.providers[0].models[0].routes['image-generation'].path`

Follow the `SkillsPanel.test.tsx` pattern: happy-dom + `createRoot` + `act()`, `PiwinUiProvider` + `DesktopLocaleProvider` wrappers, `useSettings` context stub.

- [ ] **Step 4: Implement `ImageGenerationSettings.tsx`**

Build the component with:
- Provider dropdown (from `config.providers`)
- Selected provider detail: read-only baseUrl + API key status
- Image model list (filtered by `capabilities` includes `image-generation'`)
- Add model form (model ID, request path, timeout in seconds, label, description)
- Per-model edit: inline expansion with route path, timeout, label, description fields
- "设为默认" button → sets `config.imageGeneration.defaultModel`
- Debounced auto-save via `saveConfig`

- [ ] **Step 5: Create the page wrapper**

Create `apps/desktop/src/settings/pages/image-generation-page.tsx`:

```tsx
import type { ReactElement } from 'react';
import { ImageGenerationSettings } from '../../ImageGenerationSettings';
import { useSettings } from '../settings-context';

export function ImageGenerationPage(): ReactElement {
  const settings = useSettings();
  if (!settings.config) {
    return <p className="muted">Loading…</p>;
  }
  return (
    <div className="settings-card" data-testid="settings-image-generation">
      <ImageGenerationSettings />
    </div>
  );
}
```

- [ ] **Step 6: Register the page**

Edit `apps/desktop/src/settings/pages/index.ts`:
- Import `ImageGenerationPage`
- `registerSettingsSection('image-generation', ImageGenerationPage)`

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @piwin/desktop test ImageGenerationSettings`
Expected: PASS.

Run: `pnpm --filter @piwin/desktop test settings-shell`
Expected: PASS. Note: the shell test counts nav items via `SETTINGS_SECTIONS.length` (settings-shell.test.tsx:124), so it auto-adapts to the new section — no update needed.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/settings/section-registry.ts apps/desktop/src/settings/pages/image-generation-page.tsx apps/desktop/src/settings/pages/index.ts apps/desktop/src/ImageGenerationSettings.tsx apps/desktop/src/ImageGenerationSettings.test.tsx apps/desktop/src/desktop-locale.ts
git commit -m "feat(desktop): image generation settings page with config-driven model routing"
```

---

## Task 4: Update docs (ADR, architecture, skill)

**Why:** ADR 0021 and architecture.md must reflect the config-driven routing and the new settings page. The bundled skill should mention that request paths are configurable.

**Files:**
- Modify: `docs/adr/0021-image-generation-skill.md`
- Modify: `docs/architecture.md`
- Verify: `skills/imagegen/SKILL.md` (minor update if needed)

- [ ] **Step 1: Update ADR 0021**

Update the ADR to reflect:
- `ModelConfigEntry` now has `capabilities` and `routes` for per-capability request path + timeout.
- `PiwinConfig.imageGeneration.defaultModel` is the image-gen default (independent from chat).
- `callImageEndpoint` reads `model.routes.imageGeneration.path` with protocol defaults as fallback.
- New `image-generation` settings section in Desktop.
- Backward compat: chat default model still works as last-resort fallback.

- [ ] **Step 2: Update architecture.md**

- Update `@piwin/agent-host` description to mention config-driven image routing.
- Add note about `imageGeneration` config section and `image-generation` settings page.
- Update config root section to mention `imageGeneration` under `config.json`.

- [ ] **Step 3: Update bundled skill (if needed)**

Review `skills/imagegen/SKILL.md` — update the "When the tool is unavailable" section to mention the Image Generation settings page (not just Settings → Providers).

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0021-image-generation-skill.md docs/architecture.md skills/imagegen/SKILL.md
git commit -m "docs: update ADR 0021 and architecture for config-driven image generation"
```

---

## Self-Review Checklist (after all tasks)

- [ ] `pnpm typecheck` green across all packages
- [ ] `pnpm test` green across all touched packages
- [ ] `config.providers` with no `imageGeneration` config still works (backward compat — falls back to chat default)
- [ ] `image_gen` tool returns `null` (not registered) when no image model is resolvable
- [ ] Custom request path from `model.routes.imageGeneration.path` is used over hardcoded defaults
- [ ] Timeout from `model.routes.imageGeneration.timeoutMs` is applied to the fetch call
- [ ] Image generation settings page renders, saves config, and filters models by capability
- [ ] No base64 in tool output (paths only)
- [ ] No API keys in logs or error messages
- [ ] ADR 0021 and architecture.md reflect the final implementation
- [ ] No new dependencies added
