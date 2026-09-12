/**
 * Host IPC handlers: catalog.
 */
import type {
  HostCommand,
  HostResponse,
  MediaReadData,
  SpeechTranscribeData,
} from '@piwin/contracts';
import {
  MEDIA_READ_WIRE_SAFE_BYTES,
  MEDIA_THUMB_EDGE_STANDARD_PX,
  SPEECH_MAX_DURATION_MS,
  canToggleSkill,
  createDefaultWebConfig,
  formatError,
  isMediaThumbEdge,
  modelSupportsCapability,
  projectConfiguredChatModels,
} from '@piwin/contracts';
import {
  applySettingsMutations,
  SettingsRevisionConflictError,
  SettingsService,
} from '../settings/settings-service.js';
import { isSubscriptionProvider, isV1SubscriptionProviderId } from '@piwin/contracts';
import { createMediaService } from '@piwin/media';
import { createExtensionRevisionStore } from '@piwin/extensions';
import {
  ensureBundledSkillsInstalled,
  readSkillPreview,
  SkillUninstallError,
  uninstallUserSkill,
} from '@piwin/skills';
import { loadDiscoveredResources } from '../discovered-resources.js';
import { getPiAgentDir } from '../paths.js';
import { installSkill, installExtension, listSkillStoreEntries } from '@piwin/marketplace';
import {
  getActiveTheme,
  installThemeFromLocalPath,
  listThemes,
  setActiveTheme,
} from '@piwin/theme';
import {
  deletePet,
  installPetFromLocalPath,
  installPetFromLocalPaths,
  installPetFromRegistry,
  listPets,
  queryRemotePetStore,
  scanLocalPets,
  setActivePet,
} from '@piwin/pet';
import { loadPiwinConfig, savePiwinConfig } from '../config-store.js';
import { ensureBundledExtensionsInstalled } from '../ensure-bundled-extensions.js';
import { ensureBundledPromptsInstalled } from '../ensure-bundled-prompts.js';
import { discoverProviderModels } from '../provider-model-discovery.js';
import {
  mergeProviderSecretSource,
  resolveProviderCallSecret,
} from '../provider-discovery-auth.js';
import { searchPiCatalog, searchPiImagesCatalog } from '@piwin/agent-host';
import { testProviderModel } from '../provider-model-test.js';
import { testImageGenerationModel } from '../image-generation-test.js';
import { decodeBase64Audio, transcribeOpenAiCompatible } from '@piwin/speech';
import {
  DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
  VisionDelegationCache,
  delegateImageToVisionModel,
  sharedVisionDelegationCache,
} from '../vision-delegation.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertInsideMediaRoot } from '@piwin/media';
import type { VisionDelegateResult } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import { getPiwinMediaDir, getPiwinRoot } from '../paths.js';
import { createSecretResolver } from '../secret-resolver.js';
import { findEnabledModel, findEnabledProvider } from '../provider-helpers.js';
import { resolveWebRuntimeCredentials } from '../web-credentials.js';
import { testSearchSource } from '@piwin/tools-web';
import { buildSearchRoutePreview } from '../capabilities/search-route-preview.js';
import type { HostCommandContext } from './host-command-context.js';

/**
 * In-flight pet install/query AbortControllers keyed by request id, so the
 * desktop can cancel a long-running download via `pet/cancel`. Entries are
 * removed by the owning request's `finally` block on completion.
 */
const activePetAborts = new Map<string, AbortController>();

const TYPES = new Set<HostCommand['type']>([
  'media/read',
  'speech/transcribe',
  'skills/list',
  'skills/read',
  'skills/set_enabled',
  'skills/install',
  'skills/uninstall',
  'skills/store-list',
  'extensions/list',
  'extensions/set_enabled',
  'extensions/ensure-bundled',
  'extensions/install',
  'prompts/list',
  'prompts/set_enabled',
  'theme/list',
  'theme/get-active',
  'theme/set-active',
  'theme/install-local',
  'pet/list',
  'pet/get-active',
  'pet/set-active',
  'pet/scan-local',
  'pet/install-local',
  'pet/install-local-batch',
  'pet/store-query',
  'pet/install-registry',
  'pet/cancel',
  'pet/delete',
  'config/get',
  'settings/get',
  'settings/apply',
  'models/discover',
  'models/catalog/search',
  'models/configured',
  'models/image-catalog/search',
  'models/test',
  'models/image-test',
  'web/search-route-preview',
  'vision/delegate',
  'vision/cache/clear',
  'secrets/set',
  'secrets/get',
  'web/test-search-source',
]);

export function isCatalogCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleCatalogCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'speech/transcribe': {
      try {
        const rootDir = getPiwinRoot(context.piwinRoot);
        const config = await loadPiwinConfig(rootDir);
        const asrConfig = config.speech?.asr;
        const modelRef = asrConfig?.defaultModel;
        if (!modelRef) {
          return fail(requestId, 'speech/transcribe', 'ASR model is not configured.');
        }
        const provider = findEnabledProvider(config, modelRef.providerId);
        if (!provider) {
          return fail(requestId, 'speech/transcribe', 'Configured ASR provider is unavailable.');
        }
        const model = findEnabledModel(config, modelRef.providerId, modelRef.modelId);
        if (!model || !modelSupportsCapability(model, 'speech-to-text')) {
          return fail(requestId, 'speech/transcribe', 'Configured ASR model is unavailable.');
        }
        const durationMs = command.input.durationMs;
        if (
          durationMs !== undefined &&
          (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > SPEECH_MAX_DURATION_MS)
        ) {
          return fail(requestId, 'speech/transcribe', 'Audio recording duration is invalid.');
        }
        const audio = decodeBase64Audio(command.input.base64Data);
        const secretResolver = createSecretResolver();
        let apiKey: string | null = null;
        if (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()) {
          try {
            apiKey = await secretResolver.resolveProviderSecret(provider);
          } catch (error) {
            return fail(requestId, 'speech/transcribe', formatError(error));
          }
        }
        const result = await transcribeOpenAiCompatible({
          provider,
          model,
          apiKey,
          audio,
          mimeType: command.input.mimeType,
          ...(asrConfig?.language ? { language: asrConfig.language } : {}),
        });
        const data: SpeechTranscribeData = {
          text: result.text,
          model: modelRef,
          durationMs: result.durationMs,
        };
        return ok(requestId, 'speech/transcribe', data);
      } catch (error) {
        return fail(requestId, 'speech/transcribe', formatError(error));
      }
    }
    case 'media/read': {
      // ADR 0052: preview reads address the vault by logical identity only.
      // Cap must fit a single Host wire frame (1 MiB JSON). Base64 expands
      // ~4/3; leave headroom for the response envelope so Host does not 1011
      // the whole WebSocket on encode. Generated video uses offset/length
      // slices under the same cap.
      const maxBytes = Math.min(
        MEDIA_READ_WIRE_SAFE_BYTES,
        Math.max(1024, command.input.maxBytes ?? MEDIA_READ_WIRE_SAFE_BYTES),
      );
      const rootDir = getPiwinRoot(context.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      const mediaService = createMediaService({
        mediaRoot: getPiwinMediaDir(rootDir),
        maxPasteBytes: config.media.maxPasteBytes,
        allowedMimeTypes: config.media.allowedMimeTypes,
      });
      const rangeOffset = command.input.offset;
      const rangeLength = command.input.length;
      const ranged = command.input.variant !== 'thumb' && rangeOffset !== undefined;
      const result =
        command.input.variant === 'thumb'
          ? await mediaService.readMediaThumb({
              sessionId: command.input.sessionId,
              assetId: command.input.assetId,
              maxBytes: Math.min(maxBytes, 256 * 1024),
              thumbEdge: isMediaThumbEdge(command.input.thumbEdge)
                ? command.input.thumbEdge
                : MEDIA_THUMB_EDGE_STANDARD_PX,
            })
          : await mediaService.readMediaAsset({
              sessionId: command.input.sessionId,
              assetId: command.input.assetId,
              maxBytes,
              ...(ranged ? { offset: rangeOffset } : {}),
              ...(ranged && rangeLength !== undefined ? { length: rangeLength } : {}),
            });
      if (result.status === 'unavailable') {
        const data: MediaReadData = {
          status: 'unavailable',
          reason: result.reason,
          ...(result.reason === 'too-large'
            ? { suggestion: '媒体文件超出预览大小上限。' }
            : result.reason === 'not-found'
              ? { suggestion: '该媒体资源不存在或已被清理。' }
              : {}),
        };
        return ok(requestId, 'media/read', data);
      }
      const data: MediaReadData = {
        status: 'ready',
        assetId: result.assetId,
        sessionId: result.sessionId,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        base64Data: Buffer.from(result.bytes).toString('base64'),
        ...(result.offset !== undefined ? { offset: result.offset } : {}),
      };
      return ok(requestId, 'media/read', data);
    }
    case 'skills/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      await ensureBundledSkillsInstalled(rootDir);
      const discovered = await loadCatalogResources(rootDir, command.projectPath);
      return ok(requestId, 'skills/list', { skills: discovered.skills });
    }
    case 'skills/read': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      await ensureBundledSkillsInstalled(rootDir);
      const config = await loadPiwinConfig(rootDir);
      const skillId =
        typeof command.skillId === 'string' && command.skillId.trim()
          ? command.skillId.trim()
          : undefined;
      const legacyPath =
        typeof command.legacyPath === 'string' && command.legacyPath.trim()
          ? command.legacyPath.trim()
          : undefined;
      const projectPath =
        typeof command.projectPath === 'string' && command.projectPath.trim()
          ? command.projectPath.trim()
          : undefined;
      const discovered = await loadCatalogResources(rootDir, projectPath);
      const data = await readSkillPreview({
        piwinRoot: rootDir,
        ...(config.skills ? { skillsConfig: config.skills } : {}),
        ...(skillId ? { skillId } : {}),
        ...(legacyPath ? { legacyPath } : {}),
        ...(projectPath ? { projectPath } : {}),
        ...(typeof command.maxBytes === 'number' ? { maxBytes: command.maxBytes } : {}),
        discoveredSkills: discovered.skills,
        additionalAuthorizedRoots: [getPiAgentDir()],
      });
      return ok(requestId, 'skills/read', data);
    }
    case 'skills/set_enabled': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      const skillsConfig = config.skills ?? { extraPaths: [], disabledIds: [] };
      if (!command.enabled) {
        const discovered = await loadCatalogResources(rootDir);
        const skill = discovered.skills.find((entry) => entry.id === command.skillId);
        if (skill && !canToggleSkill(skill.source)) {
          return fail(requestId, 'skills/set_enabled', 'Bundled skills cannot be disabled');
        }
      }
      const disabled = new Set(skillsConfig.disabledIds);
      if (command.enabled) {
        disabled.delete(command.skillId);
      } else {
        disabled.add(command.skillId);
      }
      config.skills = {
        extraPaths: skillsConfig.extraPaths,
        disabledIds: [...disabled],
      };
      await savePiwinConfig(config, rootDir);
      return ok(requestId, 'skills/set_enabled', {
        skillId: command.skillId,
        enabled: command.enabled,
        disabledIds: config.skills.disabledIds,
      });
    }
    case 'skills/install': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installOptions: Parameters<typeof installSkill>[0] = {
        piwinRoot: rootDir,
        source: command.source,
      };
      if (typeof command.name === 'string' && command.name.trim()) {
        installOptions.name = command.name.trim();
      }
      const result = await installSkill(installOptions);
      return ok(requestId, 'skills/install', {
        skillId: result.skillId,
        targetPath: result.targetPath,
      });
    }
    case 'skills/uninstall': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const skillId = command.skillId.trim();
      if (!skillId) {
        return fail(requestId, 'skills/uninstall', 'skillId is required');
      }
      const discovered = await loadCatalogResources(rootDir);
      const skill = discovered.skills.find((entry) => entry.id === skillId);
      if (!skill) {
        return fail(requestId, 'skills/uninstall', `Skill not found: ${skillId}`);
      }
      try {
        await uninstallUserSkill({ piwinRoot: rootDir, skill });
      } catch (error) {
        const message =
          error instanceof SkillUninstallError ? error.message : formatError(error);
        return fail(requestId, 'skills/uninstall', message);
      }
      return ok(requestId, 'skills/uninstall', { skillId });
    }
    case 'skills/store-list': {
      const entries = listSkillStoreEntries();
      return ok(requestId, 'skills/store-list', { entries });
    }
    case 'extensions/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      await ensureBundledExtensionsInstalled(rootDir);
      const discovered = await loadCatalogResources(rootDir, command.projectPath);
      return ok(requestId, 'extensions/list', { extensions: discovered.extensions });
    }
    case 'extensions/set_enabled': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const extensionStore = createExtensionRevisionStore(rootDir);
      const managedRecord = await extensionStore.getRecord(command.extensionId);
      if (managedRecord) {
        const registry = await extensionStore.setEnabled(command.extensionId, command.enabled);
        await pushExtensionCatalog(context, rootDir, registry.revision);
        const currentConfig = await loadPiwinConfig(rootDir);
        return ok(requestId, 'extensions/set_enabled', {
          extensionId: command.extensionId,
          enabled: command.enabled,
          disabledIds: currentConfig.extensions?.disabledIds ?? [],
          managed: true,
          registryRevision: registry.revision,
        });
      }
      const config = await loadPiwinConfig(rootDir);
      const extensionsConfig = config.extensions ?? {
        extraPaths: [],
        disabledIds: [],
      };
      const disabled = new Set(extensionsConfig.disabledIds);
      if (command.enabled) {
        disabled.delete(command.extensionId);
      } else {
        disabled.add(command.extensionId);
      }
      config.extensions = {
        ...extensionsConfig,
        extraPaths: extensionsConfig.extraPaths,
        disabledIds: [...disabled],
      };
      await savePiwinConfig(config, rootDir);
      return ok(requestId, 'extensions/set_enabled', {
        extensionId: command.extensionId,
        enabled: command.enabled,
        disabledIds: config.extensions.disabledIds,
      });
    }
    case 'extensions/ensure-bundled': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installed = await ensureBundledExtensionsInstalled(rootDir);
      return ok(requestId, 'extensions/ensure-bundled', {
        installed,
      });
    }
    case 'extensions/install': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installOptions: Parameters<typeof installExtension>[0] = {
        piwinRoot: rootDir,
        source: command.source,
      };
      if (typeof command.name === 'string' && command.name.trim()) {
        installOptions.name = command.name.trim();
      }
      const result = await installExtension(installOptions);
      await pushExtensionCatalog(context, rootDir, result.registryRevision);
      return ok(requestId, 'extensions/install', {
        extensionId: result.extensionId,
        targetPath: result.targetPath,
        packageRoot: result.packageRoot,
        contentRevision: result.contentRevision,
        registryRevision: result.registryRevision,
        configuredEnabled: result.configuredEnabled,
      });
    }
    case 'prompts/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      await ensureBundledPromptsInstalled(rootDir);
      const discovered = await loadCatalogResources(rootDir, command.projectPath);
      return ok(requestId, 'prompts/list', { prompts: discovered.prompts });
    }
    case 'prompts/set_enabled': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      const promptsConfig = config.prompts ?? {
        extraPaths: [],
        disabledIds: [],
      };
      const disabled = new Set(promptsConfig.disabledIds);
      if (command.enabled) {
        disabled.delete(command.promptId);
      } else {
        disabled.add(command.promptId);
      }
      config.prompts = {
        extraPaths: promptsConfig.extraPaths,
        disabledIds: [...disabled],
      };
      await savePiwinConfig(config, rootDir);
      return ok(requestId, 'prompts/set_enabled', {
        promptId: command.promptId,
        enabled: command.enabled,
        disabledIds: config.prompts.disabledIds,
      });
    }
    case 'theme/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const data = await listThemes(rootDir);
      return ok(requestId, 'theme/list', data);
    }
    case 'theme/get-active': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const theme = await getActiveTheme(rootDir);
      return ok(requestId, 'theme/get-active', { theme });
    }
    case 'theme/set-active': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const theme = await setActiveTheme(rootDir, command.themeId);
      return ok(requestId, 'theme/set-active', { theme });
    }
    case 'theme/install-local': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installed = await installThemeFromLocalPath(rootDir, command.sourcePath);
      return ok(requestId, 'theme/install-local', installed);
    }
    case 'pet/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const data = await listPets(rootDir);
      return ok(requestId, 'pet/list', data);
    }
    case 'pet/get-active': {
      const pet = context.petStateStore.snapshot().pet;
      return ok(requestId, 'pet/get-active', { pet });
    }
    case 'pet/set-active': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const pet = await setActivePet(rootDir, command.petId);
      context.petStateStore.setBase(pet);
      return ok(requestId, 'pet/set-active', { pet });
    }
    case 'pet/scan-local': {
      const preview = await scanLocalPets(command.sourcePath);
      return ok(requestId, 'pet/scan-local', preview);
    }
    case 'pet/install-local': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installed = await installPetFromLocalPath(rootDir, command.sourcePath);
      return ok(requestId, 'pet/install-local', installed);
    }
    case 'pet/install-local-batch': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const result = await installPetFromLocalPaths(rootDir, command.sourcePaths);
      return ok(requestId, 'pet/install-local-batch', result);
    }
    case 'pet/store-query': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const controller = new AbortController();
      if (requestId) activePetAborts.set(requestId, controller);
      try {
        const results = await queryRemotePetStore(rootDir, command.query.query, controller.signal);
        return ok(requestId, 'pet/store-query', { results });
      } finally {
        if (requestId) activePetAborts.delete(requestId);
      }
    }
    case 'pet/install-registry': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const controller = new AbortController();
      if (requestId) activePetAborts.set(requestId, controller);
      try {
        const installed = await installPetFromRegistry(rootDir, command.url, controller.signal);
        return ok(requestId, 'pet/install-registry', installed);
      } finally {
        if (requestId) activePetAborts.delete(requestId);
      }
    }
    case 'pet/cancel': {
      const controller = activePetAborts.get(command.requestId);
      if (controller) {
        controller.abort();
        activePetAborts.delete(command.requestId);
      }
      return ok(requestId, 'pet/cancel', { cancelled: true });
    }
    case 'pet/delete': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const result = await deletePet(rootDir, command.petId);
      if (result.fallbackPet) {
        context.petStateStore.setBase(result.fallbackPet);
      }
      return ok(requestId, 'pet/delete', { deleted: true, fallbackPet: result.fallbackPet });
    }

    case 'config/get': {
      const configRoot = getPiwinRoot(context.piwinRoot);
      const config = await loadPiwinConfig(configRoot);
      return ok(requestId, 'config/get', { config, root: configRoot });
    }
    case 'settings/get': {
      const settingsService = new SettingsService({ piwinRoot: context.piwinRoot });
      const snapshot = await settingsService.getSnapshot();
      return ok(requestId, 'settings/get', { snapshot, root: getPiwinRoot(context.piwinRoot) });
    }
    case 'settings/apply': {
      const settingsService = new SettingsService({ piwinRoot: context.piwinRoot });
      try {
        if (command.input.mutations.some((mutation) => mutation.domain === 'providers')) {
          const current = await settingsService.getSnapshot();
          const nextConfig = applySettingsMutations(current.config, command.input.mutations);
          const { getSubscriptionAuthService } = await import('./auth-commands.js');
          const accounts = (await getSubscriptionAuthService(context).status()).accounts;
          const blocked = new Set(
            accounts
              .filter(
                (account) =>
                  isV1SubscriptionProviderId(account.providerId) &&
                  (account.state === 'logged-in' ||
                    account.state === 'logging-in' ||
                    account.state === 'sync-error' ||
                    account.state === 'needs-reauth'),
              )
              .map((account) => account.providerId),
          );
          const colliding = nextConfig.providers.find(
            (provider) => blocked.has(provider.id) && !isSubscriptionProvider(provider),
          );
          if (colliding) {
            return fail(
              requestId,
              'settings/apply',
              `Channel id "${colliding.id}" collides with a logged-in subscription account.`,
              { code: 'collision', data: { providerId: colliding.id } },
            );
          }
        }
        const result = await settingsService.apply(command.input);
        if (result.changedDomains.length > 0) {
          context.push({
            type: 'settings/updated',
            revision: result.snapshot.revision,
            runtimeRevision: result.snapshot.runtimeRevision,
            changedDomains: result.changedDomains.map((impact) => impact.domain),
          });
        }
        return ok(requestId, 'settings/apply', result);
      } catch (error) {
        if (error instanceof SettingsRevisionConflictError) {
          return fail(requestId, 'settings/apply', 'settings-revision-conflict', {
            code: 'settings-revision-conflict',
            data: {
              expectedRevision: error.expectedRevision,
              actualRevision: error.actualRevision,
              conflictingDomains: error.conflictingDomains,
              ...(error.snapshot === undefined ? {} : { snapshot: error.snapshot }),
            },
          });
        }
        throw error;
      }
    }
    case 'web/search-route-preview': {
      const config = await loadPiwinConfig(context.piwinRoot);
      const data = buildSearchRoutePreview(config, command.input);
      return ok(requestId, 'web/search-route-preview', data);
    }
    case 'models/discover': {
      try {
        // Host owns secrets. Remote shells send a stripped provider row; pull
        // the stored ref from this Host's config and resolve it here.
        const secretResolver = createSecretResolver();
        const oneShotApiKey = command.apiKey?.trim();
        const config = await loadPiwinConfig(getPiwinRoot(context.piwinRoot));
        const persisted = config.providers.find((entry) => entry.id === command.provider.id);
        const provider = mergeProviderSecretSource(command.provider, persisted);
        const result = await discoverProviderModels(provider, {
          resolveSecret: async (candidate) =>
            resolveProviderCallSecret({
              provider: candidate,
              ...(oneShotApiKey ? { oneShotApiKey } : {}),
              resolveSecret: (source) => secretResolver.resolveProviderSecret(source),
            }),
        });
        return ok(requestId, 'models/discover', result);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'models/discover', message);
      }
    }
    case 'models/catalog/search': {
      try {
        const result = searchPiCatalog(command.input ?? {});
        return ok(requestId, 'models/catalog/search', result);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'models/catalog/search', message);
      }
    }
    case 'models/configured': {
      try {
        const { getSubscriptionAuthService } = await import('./auth-commands.js');
        const service = getSubscriptionAuthService(context);
        const config = await service.ensureLoggedInProviders();
        const projected = projectConfiguredChatModels(config);
        const merged = await service.mergeConfiguredModels(projected);
        return ok(requestId, 'models/configured', merged);
      } catch {
        const config = await loadPiwinConfig(getPiwinRoot(context.piwinRoot));
        return ok(requestId, 'models/configured', projectConfiguredChatModels(config));
      }
    }
    case 'models/image-catalog/search': {
      // Pi maintains a separate ImagesModel catalog from the chat Model catalog.
      // Image Generation settings uses this to match discovered provider models
      // against known image-generation model ids (split-name / full-id).
      try {
        const result = searchPiImagesCatalog();
        return ok(requestId, 'models/image-catalog/search', result);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'models/image-catalog/search', message);
      }
    }
    case 'models/test': {
      try {
        const secretResolver = createSecretResolver();
        const oneShotApiKey = command.apiKey?.trim();
        const config = await loadPiwinConfig(getPiwinRoot(context.piwinRoot));
        const persisted = config.providers.find((entry) => entry.id === command.provider.id);
        // Same Host-owned secret rule as models/discover.
        const provider = mergeProviderSecretSource(command.provider, persisted);
        const result = await testProviderModel(provider, command.modelId, {
          resolveSecret: async (candidate) =>
            resolveProviderCallSecret({
              provider: candidate,
              ...(oneShotApiKey ? { oneShotApiKey } : {}),
              resolveSecret: (source) => secretResolver.resolveProviderSecret(source),
            }),
        });
        return ok(requestId, 'models/test', result);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'models/test', message);
      }
    }
    case 'models/image-test': {
      try {
        const secretResolver = createSecretResolver();
        const oneShotApiKey = command.apiKey?.trim();
        const config = await loadPiwinConfig(getPiwinRoot(context.piwinRoot));
        const persisted = config.providers.find((entry) => entry.id === command.provider.id);
        const provider = mergeProviderSecretSource(command.provider, persisted);
        const result = await testImageGenerationModel(
          provider,
          command.modelId,
          command.prompt,
          {
            secretResolver,
            ...(oneShotApiKey ? { apiKey: oneShotApiKey } : {}),
          },
        );
        return ok(requestId, 'models/image-test', result);
      } catch (error) {
        return fail(requestId, 'models/image-test', formatError(error));
      }
    }
    case 'vision/cache/clear': {
      sharedVisionDelegationCache.clear();
      return ok(requestId, 'vision/cache/clear', { cleared: true });
    }
    case 'vision/delegate': {
      let tempDir: string | null = null;
      try {
        const rootDir = getPiwinRoot(context.piwinRoot);
        const config = await loadPiwinConfig(rootDir);
        const visionConfig = config.visionDelegation;
        if (!visionConfig?.enabled || !visionConfig.model) {
          return fail(
            requestId,
            'vision/delegate',
            'Vision delegation is not enabled or no vision model is configured',
          );
        }
        const visionRef = visionConfig.model;
        const visionProvider = findEnabledProvider(config, visionRef.providerId);
        if (!visionProvider) {
          return fail(
            requestId,
            'vision/delegate',
            `Vision provider not found: ${visionRef.providerId}`,
          );
        }
        const secretResolver = createSecretResolver();
        const apiKey = await secretResolver.resolveProviderSecret(visionProvider);
        if (!apiKey) {
          return fail(requestId, 'vision/delegate', 'Could not resolve vision model API key');
        }

        const mimeType = command.input.mimeType?.trim();
        if (!mimeType) {
          return fail(requestId, 'vision/delegate', 'mimeType is required');
        }

        let imagePath = command.input.imagePath?.trim();
        if (imagePath) {
          const mediaRoot = getPiwinMediaDir(rootDir);
          assertInsideMediaRoot(mediaRoot, imagePath);
        } else if (command.input.imageBase64?.trim()) {
          tempDir = await mkdtemp(join(tmpdir(), 'piwin-vision-'));
          const ext =
            mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
          imagePath = join(tempDir, `preview.${ext}`);
          await writeFile(imagePath, Buffer.from(command.input.imageBase64, 'base64'));
        } else {
          return fail(requestId, 'vision/delegate', 'imagePath or imageBase64 is required');
        }

        const systemPrompt =
          command.input.prompt?.trim() ||
          visionConfig.systemPrompt?.trim() ||
          DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT;
        const fileBytes = await readFile(imagePath);
        const cacheKey =
          visionConfig.cacheEnabled === false
            ? null
            : VisionDelegationCache.buildKey({
                fileBytes,
                mimeType,
                providerId: visionRef.providerId,
                modelId: visionRef.modelId,
                systemPrompt,
              });
        let cacheHit = false;
        let description: string | undefined;
        if (cacheKey) {
          description = sharedVisionDelegationCache.get(cacheKey);
          cacheHit = description !== undefined;
        }
        const started = Date.now();
        if (!description) {
          description = await delegateImageToVisionModel({
            imagePath,
            mimeType,
            provider: visionProvider,
            modelId: visionRef.modelId,
            apiKey,
            systemPrompt,
            ...(visionConfig.timeoutMs !== undefined ? { timeoutMs: visionConfig.timeoutMs } : {}),
          });
          if (cacheKey) {
            sharedVisionDelegationCache.set(cacheKey, description);
          }
        }
        const result: VisionDelegateResult = {
          description,
          model: visionRef,
          durationMs: Date.now() - started,
          cacheHit,
        };
        return ok(requestId, 'vision/delegate', result);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'vision/delegate', message);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
    case 'secrets/set': {
      try {
        const secretResolver = createSecretResolver();
        const apiKeyRef = await secretResolver.writeProviderSecret(
          command.providerId,
          command.secret,
        );
        return ok(requestId, 'secrets/set', { apiKeyRef, providerId: command.providerId });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'secrets/set', message);
      }
    }
    case 'secrets/get': {
      try {
        const secretResolver = createSecretResolver();
        const raw = await secretResolver.readProviderSecret(command.providerId);
        if (!raw || !raw.trim()) {
          return ok(requestId, 'secrets/get', {
            providerId: command.providerId,
            keys: [] as Array<{ index: number; preview: string }>,
          });
        }
        const keys = raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((value, index) => ({
            index,
            preview: maskSecretPreview(value),
          }));
        return ok(requestId, 'secrets/get', {
          providerId: command.providerId,
          keys,
          /** Full multi-line payload only for key-manager edit path; UI must not log. */
          secret: raw,
        });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'secrets/get', message);
      }
    }
    case 'web/test-search-source': {
      try {
        const config = await loadPiwinConfig(getPiwinRoot(context.piwinRoot));
        const draft = command.input.source;
        const source =
          draft && draft.id === command.input.sourceId && draft.kind === command.input.kind
            ? draft
            : config.web?.searchSources.find(
                (candidate) => candidate.id === command.input.sourceId,
              );
        if (!source) {
          return fail(
            requestId,
            'web/test-search-source',
            `Web search source not found: ${command.input.sourceId}`,
          );
        }
        if (source.kind !== command.input.kind) {
          return fail(
            requestId,
            'web/test-search-source',
            `Web search source kind changed: expected ${command.input.kind}, got ${source.kind}`,
          );
        }
        if (!config.web && !draft) {
          return fail(requestId, 'web/test-search-source', 'Web tools are not configured');
        }
        const credentials = await resolveWebRuntimeCredentials(
          config.web ?? createDefaultWebConfig(),
          createSecretResolver(),
        );
        return ok(requestId, 'web/test-search-source', await testSearchSource(source, credentials));
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'web/test-search-source', message);
      }
    }
    default:
      return null;
  }
}

async function loadCatalogResources(rootDir: string, projectPath?: string) {
  const config = await loadPiwinConfig(rootDir);
  const path = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : undefined;
  return loadDiscoveredResources({
    piwinRoot: rootDir,
    ...(path ? { projectPath: path } : {}),
    ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
    ...(config.skills ? { skillsConfig: config.skills } : {}),
    ...(config.prompts ? { promptsConfig: config.prompts } : {}),
  });
}

async function pushExtensionCatalog(
  context: HostCommandContext,
  rootDir: string,
  registryRevision: string,
): Promise<void> {
  await ensureBundledExtensionsInstalled(rootDir);
  const discovered = await loadCatalogResources(rootDir);
  context.push({
    type: 'extension/catalog-updated',
    registryRevision,
    extensions: discovered.extensions,
  });
}

function maskSecretPreview(secret: string): string {
  const value = secret.trim();
  if (value.length <= 10) {
    return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 2))}`;
  }
  return `${value.slice(0, 6)}${'*'.repeat(6)}${value.slice(-4)}`;
}
