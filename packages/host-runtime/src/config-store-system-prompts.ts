/**
 * Normalization helpers for `PiwinConfig.systemPrompts`.
 */
import type {
  BuiltinSystemPromptSlotId,
  BuiltinSystemPromptStackConfig,
  SystemPromptPreset,
  SystemPromptsConfig,
} from '@piwin/contracts';
import {
  isBuiltinSystemPromptSlotId,
  isValidSystemPromptPresetId,
  MAX_SYSTEM_PROMPT_PRESETS,
  normalizeSystemPromptFileStack,
  SYSTEM_PROMPT_BUILTIN_ID,
} from '@piwin/contracts';
import { asRecord } from './config-store-primitives.js';

function normalizeBoundedText(raw: unknown, maxChars: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxChars);
}

export function normalizeSystemPromptsConfig(value: unknown): SystemPromptsConfig | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const presets: SystemPromptPreset[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(record.presets)) {
    for (const rawItem of record.presets) {
      if (presets.length >= MAX_SYSTEM_PROMPT_PRESETS) break;
      const item = asRecord(rawItem);
      if (!item) continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const name = normalizeBoundedText(item.name, 120);
      const rawPaths = Array.isArray(item.filePaths)
        ? item.filePaths.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const filePaths = normalizeSystemPromptFileStack(rawPaths);
      if (!isValidSystemPromptPresetId(id) || seenIds.has(id) || !name || filePaths.length === 0) {
        continue;
      }
      seenIds.add(id);
      presets.push({
        id,
        name,
        mode: item.mode === 'replace' ? 'replace' : 'append',
        filePaths,
        updatedAt:
          typeof item.updatedAt === 'string' && item.updatedAt.trim().length > 0
            ? item.updatedAt.trim()
            : new Date(0).toISOString(),
      });
    }
  }

  const defaultPresetIdRaw = typeof record.defaultPresetId === 'string' ? record.defaultPresetId.trim() : '';
  const defaultPresetId =
    defaultPresetIdRaw && isValidSystemPromptPresetId(defaultPresetIdRaw)
      ? defaultPresetIdRaw
      : undefined;

  const projectPresetIds: Record<string, string> = {};
  const rawProjectMap = asRecord(record.projectPresetIds);
  if (rawProjectMap) {
    for (const [projectPath, rawPresetId] of Object.entries(rawProjectMap)) {
      const trimmedPath = projectPath.trim();
      const presetId = typeof rawPresetId === 'string' ? rawPresetId.trim() : '';
      if (!trimmedPath || !presetId) continue;
      if (presetId === SYSTEM_PROMPT_BUILTIN_ID || isValidSystemPromptPresetId(presetId)) {
        projectPresetIds[trimmedPath] = presetId;
      }
    }
  }

  const builtinStacks: Partial<Record<BuiltinSystemPromptSlotId, BuiltinSystemPromptStackConfig>> =
    {};
  const rawBuiltinStacks = asRecord(record.builtinStacks);
  if (rawBuiltinStacks) {
    for (const [slotId, rawStack] of Object.entries(rawBuiltinStacks)) {
      if (!isBuiltinSystemPromptSlotId(slotId)) continue;
      const item = asRecord(rawStack);
      if (!item) continue;
      const includeBuiltin = item.includeBuiltin !== false;
      const rawPaths = Array.isArray(item.filePaths)
        ? item.filePaths.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const filePaths = normalizeSystemPromptFileStack(rawPaths);
      if (!includeBuiltin || filePaths.length > 0) {
        builtinStacks[slotId] = { includeBuiltin, filePaths };
      }
    }
  }

  const hasProjects = Object.keys(projectPresetIds).length > 0;
  const hasBuiltinStacks = Object.keys(builtinStacks).length > 0;
  if (presets.length === 0 && !defaultPresetId && !hasProjects && !hasBuiltinStacks) {
    return undefined;
  }

  return {
    presets,
    ...(defaultPresetId ? { defaultPresetId } : {}),
    ...(hasProjects ? { projectPresetIds } : {}),
    ...(hasBuiltinStacks ? { builtinStacks } : {}),
  };
}
