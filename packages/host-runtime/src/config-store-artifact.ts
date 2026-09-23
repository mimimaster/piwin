import type {
  ArtifactConfig,
  ArtifactPromptMode,
  ArtifactScopesConfig,
  ArtifactSurfaceSwitches,
  ArtifactTriggerMode,
} from '@piwin/contracts';
import { createDefaultArtifactScopes } from '@piwin/contracts';
import { asPositiveNumber, asRecord } from './config-store-primitives.js';

/**
 * Normalize `PiwinConfig.artifact`: surface switches, trigger/prompt modes, and per-scope overrides.
 */

export function normalizeArtifactScopes(value: unknown): ArtifactScopesConfig {
  const record = asRecord(value);
  const fallback = createDefaultArtifactScopes();
  const switches = (
    raw: unknown,
    scopeDefault: ArtifactSurfaceSwitches,
  ): ArtifactSurfaceSwitches => {
    const entry = asRecord(raw);
    if (!entry) {
      return { ...scopeDefault };
    }
    return {
      inline: entry.inline !== false,
      canvas: entry.canvas !== false,
    };
  };
  return {
    general: switches(record?.general, fallback.general),
    project: switches(record?.project, fallback.project),
  };
}

export function normalizeArtifactConfig(value: unknown, defaults: ArtifactConfig): ArtifactConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  // Migration: old shape had `htmlUiModeDefault: boolean` instead of `enabled`.
  const hasEnabled = typeof record.enabled === 'boolean';
  const hasLegacy = typeof record.htmlUiModeDefault === 'boolean';
  const enabled = hasEnabled
    ? Boolean(record.enabled)
    : hasLegacy
      ? Boolean(record.htmlUiModeDefault)
      : defaults.enabled;
  const triggerMode: ArtifactTriggerMode =
    record.triggerMode === 'explicit-only' ? 'explicit-only' : defaults.triggerMode;
  const decisionPromptRecord = asRecord(record.decisionPrompt);
  const promptMode: ArtifactPromptMode =
    decisionPromptRecord?.mode === 'custom' ? 'custom' : 'default';
  const customPrompt =
    typeof decisionPromptRecord?.customPrompt === 'string' ? decisionPromptRecord.customPrompt : '';
  const maxBytes = asPositiveNumber(record.maxBytes) ?? defaults.maxBytes;
  return {
    enabled,
    scopes: normalizeArtifactScopes(record.scopes),
    triggerMode,
    decisionPrompt: { mode: promptMode, customPrompt },
    maxBytes,
    blockExternalScripts: record.blockExternalScripts === false ? false : true,
    blockExternalResources: record.blockExternalResources === false ? false : true,
  };
}
