/**
 * Normalization helpers for `PiwinConfig.systemPrompts`.
 */
import type {
  DirectSystemPromptOverrideSlotId,
  SystemPromptPreset,
  SystemPromptsConfig,
} from '@piwin/contracts';
import {
  isValidSystemPromptPresetId,
  MAX_SYSTEM_PROMPT_CONTENT_CHARS,
  MAX_SYSTEM_PROMPT_PRESETS,
  SYSTEM_PROMPT_BUILTIN_ID,
} from '@piwin/contracts';
import { asRecord } from './config-store-primitives.js';

const DIRECT_OVERRIDE_SLOTS: readonly DirectSystemPromptOverrideSlotId[] = [
  'agent.default',
  'agent.goal',
  'conversation.chat',
  'web.fetch-extract',
];

function isDirectOverrideSlotId(key: string): key is DirectSystemPromptOverrideSlotId {
  return (DIRECT_OVERRIDE_SLOTS as readonly string[]).includes(key);
}

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
      const content = normalizeBoundedText(item.content, MAX_SYSTEM_PROMPT_CONTENT_CHARS);
      if (!isValidSystemPromptPresetId(id) || seenIds.has(id) || !name || !content) {
        continue;
      }
      seenIds.add(id);
      presets.push({
        id,
        name,
        mode: item.mode === 'replace' ? 'replace' : 'append',
        content,
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

  const builtinOverrides: Partial<Record<DirectSystemPromptOverrideSlotId, string>> = {};
  const rawOverrides = asRecord(record.builtinOverrides);
  if (rawOverrides) {
    for (const [slotId, rawText] of Object.entries(rawOverrides)) {
      if (!isDirectOverrideSlotId(slotId)) continue;
      const text = normalizeBoundedText(rawText, MAX_SYSTEM_PROMPT_CONTENT_CHARS);
      if (text) {
        builtinOverrides[slotId] = text;
      }
    }
  }

  const hasProjects = Object.keys(projectPresetIds).length > 0;
  const hasOverrides = Object.keys(builtinOverrides).length > 0;
  if (presets.length === 0 && !defaultPresetId && !hasProjects && !hasOverrides) {
    return undefined;
  }

  return {
    presets,
    ...(defaultPresetId ? { defaultPresetId } : {}),
    ...(hasProjects ? { projectPresetIds } : {}),
    ...(hasOverrides ? { builtinOverrides } : {}),
  };
}
